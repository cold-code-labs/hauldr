# Data plane

The data plane is the shared, stateful core of Hauldr: Postgres, the multi-
tenant connection pooler, and the backup machinery. It is where tenant data
actually lives.

## Postgres

Postgres runs **inside the stack** as a container, alongside the rest of Hauldr —
not as a host-level install.

- **Portability over a dedicated box.** Because Postgres is part of the stack,
  the whole platform comes up on any Docker host with one recipe. Nothing assumes
  a hand-tuned host install.
- **One database per project.** Each project gets its own database for logical
  isolation inside the cluster.
- **Extensions per database.** Things like `pgvector` are enabled per-database,
  on demand — a project only carries what it uses.

The honest trade-off: projects on the same cluster share its resources and its
fault domain. The relief valve is [tiering](#tiering).

## Migrations

Hauldr is **SQL-first**.

- **Versioned `.sql` files are the canonical schema.** They are applied by
  Hauldr's migration runner. This is deliberate: RLS policies, functions, and
  triggers are SQL, and the schema contract should express them directly rather
  than through an abstraction that rounds them off.
- **Drizzle is the typed layer.** On top of the SQL schema, [Drizzle](https://orm.drizzle.team/)
  provides typed queries and types in the SDK and applications.
- **No ORM-driven migrations.** Hauldr avoids migration tooling that fights with
  row-level security or with the pooler's transaction mode.

```
migrations/
  0001_init.sql            -- tables
  0002_rls_policies.sql    -- row-level security
  0003_functions.sql       -- functions / triggers
```

## The pooler

A multi-tenant connection pooler sits in front of Postgres.

- It **routes each project to its database**.
- It **caps connections**, so a server hosting many projects doesn't run into
  Postgres's connection ceiling.
- It runs in **transaction mode**.

> ⚠️ **Transaction mode and RLS.** In transaction mode, connections are handed
> out per transaction and reused across clients. Any per-request state — notably
> the auth claim used by RLS — must be set as a **transaction-local** setting
> (`set_config(..., true)`), never session-level. A session-level setting would
> leak to whoever gets the connection next.

## Tiering

```
A project starts here…                         …and can move here when it earns it

 SHARED CLUSTER                                 DEDICATED CLUSTER
 ┌─ db_acme ─┐                                  ┌─ db_bigco ─┐
 ├─ db_shop ─┤   ── promote "bigco" ───────▶    │            │
 ├─ db_blog ─┤                                  └────────────┘
 └─ db_bigco┘
```

- Every project **starts on the shared cluster**.
- A project that **grows or becomes critical** is promoted to a **dedicated
  cluster**.
- The pooler **re-points the route**; the application does not change its
  connection logic.

Tiering is the answer to two problems at once: noisy neighbors (a busy project
slowing others) and fault isolation (keeping a critical project off a shared
blast radius).

## Backups

Two complementary mechanisms:

- **Cluster-level WAL archiving** for **point-in-time recovery** — roll the whole
  cluster back to any moment.
- **Per-database dumps** for **granular restore** — restore a single project's
  database without touching the others.

Per-database restore is a first-class operation. Compared to backing up N
separate database volumes, a logical per-database dump makes "restore just this
one project to last Tuesday" straightforward.

## Observability

Postgres metrics are collected and surfaced **per project** in the panel, so an
operator can see which project is doing what without leaving the control plane.
