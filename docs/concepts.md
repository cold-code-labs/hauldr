# Concepts

A short tour of the model behind Hauldr and the vocabulary used throughout the
docs.

## The mental model

Hauldr separates the system into two planes plus a thin per-project layer:

- **Control plane** — where you *operate*: the panel and the management API.
- **Data plane** — where data *lives*: Postgres, the pooler, the object store.
  Shared and multi-tenant.
- **Satellites** — small per-project services attached on demand: auth (always)
  and a REST layer (optional).

The guiding rule is that **heavy, stateful things are shared** and **light
things are per-project and optional**.

## Glossary

**Project**
: The unit of tenancy. A project is one Postgres database, one auth service, a
  JWT secret, an object-storage bucket, and a set of API keys. Applications are
  built against a project.

**Control plane**
: The panel plus the management API. It creates and operates projects but does
  not sit in the hot path of application traffic.

**Data plane**
: The shared, stateful core: the Postgres cluster(s), the multi-tenant
  connection pooler, and the object store.

**Satellite**
: A per-project service attached à-la-carte. Auth (GoTrue) is always present;
  the REST layer (PostgREST) is optional.

**Pooler**
: The multi-tenant connection pooler in front of Postgres. It routes each
  project to its database and caps connection counts. Runs in transaction mode,
  which is why the RLS claim is set per transaction.

**RLS (row-level security)**
: Postgres's built-in access control. Policies decide which rows a request may
  read or write, based on the claims in the auth token. In Hauldr, RLS is
  **always on**.

**Claim injection**
: Making the database aware of *who* is asking. The user's auth claim is set as
  a transaction-local setting so RLS policies can read it. Automatic when going
  through the REST layer; done by the data layer for server actions.

**Project zero**
: The bootstrap project that backs the panel itself. Created by the installer,
  not through the UI — this resolves the chicken-and-egg of a panel that is
  itself a Hauldr project.

**Tier**
: How much isolation a project gets. Projects start on the **shared** cluster;
  one that grows or is critical can be promoted to a **dedicated** cluster
  without changing application code.

**Service token**
: A credential for machine-to-machine calls to the management API (e.g. an
  external provisioning system creating a project).

## Tenancy model

```
Postgres cluster (shared)
 ├── db_acme    ← project "acme"   ── auth (GoTrue)  ── bucket acme
 ├── db_shop    ← project "shop"   ── auth (GoTrue)  ── bucket shop  ── REST (PostgREST)
 └── db_blog    ← project "blog"   ── auth (GoTrue)  ── bucket blog
```

- **One database per project** gives logical isolation inside a shared cluster.
- **Each project has its own auth** and its own JWT secret — auth is never shared
  across projects.
- **Each project has its own bucket** in the shared object store.
- The **REST layer is opt-in** per project.

## Tiering, visually

```
SHARED CLUSTER                          DEDICATED CLUSTER
(many small projects)                   (one project that outgrew shared)

 ┌─ db_acme ─┐                           ┌─ db_bigco ─┐
 ├─ db_shop ─┤   ── promote bigco ──▶    │            │
 ├─ db_blog ─┤                           └────────────┘
 └─ db_bigco┘
```

The pooler re-points the project's route; application code is unchanged.

## Why these choices

- **One auth per project, RLS always** — security is enforced in the database, so
  it holds regardless of how data is accessed, and a bug in one app can't reach
  another project's data.
- **SQL-first schema** — RLS, functions, and triggers are SQL; the canonical
  schema is SQL so nothing is lost in translation. A typed layer sits on top for
  developer ergonomics.
- **Shared-by-default, dedicated-on-demand** — small projects are cheap to run
  together; the ones that matter get isolation when they earn it.
