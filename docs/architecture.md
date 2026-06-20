# Architecture

Hauldr is a self-hosted, multi-tenant Backend-as-a-Service built on real
Postgres. This document describes the full system: what runs where, why, and how
the pieces fit together.

## The shape of the problem

Hauldr targets a specific workload: running **many small applications**, each
needing a proper backend, on infrastructure you own. Think one app per client,
per product, or per internal tool — dozens of them, each with a handful to a few
dozen users.

For that workload, the usual options each cost something:

- A **full managed-style stack per app** gives isolation but multiplies
  deployment and memory overhead by the number of apps.
- An **embedded single-file database per app** is light but eventually hits real
  ceilings: concurrent writers, row-level security, point-in-time recovery,
  connection scaling, true SQL.

Hauldr's answer is a deliberate split:

> **Heavy things are shared. Light things are per-project and optional.**

The expensive, stateful machinery — the database cluster, the connection pooler,
the object store — is shared and multi-tenant. Each project carries only a thin,
optional set of satellites on top.

## Topology

```
   CONTROL PLANE                              DATA PLANE  (shared)
 ┌────────────────────────┐              ┌──────────────────────────────────────┐
 │ Hauldr Panel           │              │  Connection pooler (MULTI-TENANT)      │
 │  (SQL editor /         │  ── API ──▶  │   routes project → db, caps conns      │
 │   table editor /       │              │          │                             │
 │   auth & users /       │  ◀── meta ── │  Postgres (1+ cluster, 1 DB/project)   │
 │   RLS / keys /         │              │   ├ db_acme   ├ db_shop   ├ …          │
 │   logs / backups)      │              └──────────────────────────────────────┘
 │                        │                  ▲ per-project, à-la-carte
 │ Hauldr API (mgmt)      │                  │  ┌ Auth (GoTrue)    [ALWAYS]
 └───────────┬────────────┘                  │  └ REST (PostgREST) [optional]
             │ called by                      │     realtime = shared Realtime (WS)
   your provisioning automation               │     storage  = shared S3 store
```

There are three layers:

1. **Control plane** — a panel and a management API.
2. **Shared data plane** — Postgres + a multi-tenant pooler + an object store.
3. **Per-project satellites** — auth (always) and a REST layer (optional).

## Principles

1. **Shared is heavy, per-project is light and optional.** Tenancy lives in the
   shared plane. A project adds only what it needs.
2. **One auth model, always.** Every project gets its own GoTrue and its own JWT
   secret. Row-level security is always on; policies read the JWT claims.
3. **Real Postgres underneath.** Extensions are enabled per-database, on demand.
4. **Scale honestly.** A pooler bounds connections; tiering moves a hot project
   to a dedicated cluster without app changes.
5. **Assemble upstream, don't reinvent.** Build the panel, provisioner, SDK, and
   conventions — never the database, pooler, or auth server.

## Auth & data

**Auth is GoTrue, always, per project.** Each project is born with its own
GoTrue instance (an auth schema in its database, its own JWT secret). This gives
per-project auth isolation: signup, email confirmation, password reset, OAuth,
magic links, and MFA are all available out of the box, issuing standard JWTs.

**Row-level security is always on.** Security is enforced by the database, not by
application code. RLS policies read the claims from the GoTrue-issued JWT, so the
same rules apply no matter how the data is accessed.

**Data access has two modes:**

- **Server actions (default).** The application talks to Postgres through the
  pooler. The data layer injects the auth claim per transaction so RLS applies.
- **REST API (à-la-carte).** When a project needs a raw REST API exposed to the
  outside, it can enable a PostgREST satellite. With PostgREST the claim
  injection is automatic.

Because the pooler runs in transaction mode, the claim is set **per
transaction** (a transaction-local setting), not per session.

| Composition           | Services                          | Footprint per project |
| --------------------- | --------------------------------- | --------------------- |
| **Default**           | app + auth + database             | small                 |
| **+ REST API**        | app + auth + REST + database      | small + the REST layer|

See [auth-and-data.md](auth-and-data.md) for the full model.

## Control plane

### The panel

A self-hosted web panel — the operator's surface for the whole platform:

- **Projects** — create, list, status, metrics, tier
- **SQL editor** — run queries against a project's database
- **Table editor** — browse and edit data
- **Auth & users** — manage users and sessions
- **RLS policies** — edit policies and test "as user X"
- **API & keys** — connection string, anon/service keys, REST URL
- **Logs** — query and auth logs
- **Backups** — point-in-time recovery and granular per-database restore
- **Services** — per-project toggles (REST layer, extensions)
- **Settings** — tier, move to a dedicated cluster

### The management API

A REST/RPC API that the panel uses **and** that external systems call. Core
operations:

```
createProject · dropProject · runMigration · toggleService · setProfile
createApiKey  · getConnectionString · listUsers · backup · restore
```

This is the integration point: **your provisioning automation calls the Hauldr
API** to create a project's database when it spins up a new app. The panel is
just one client of this API.

## Data plane

### Postgres

Postgres runs **inside the stack** as a container (alongside the rest of
Hauldr), not as a host install. That keeps the whole platform portable — Hauldr
comes up on any Docker host. The trade-off is an honest one: the shared cluster
shares a fault domain; the relief valve is **tiering** a project to a dedicated
cluster when it matters.

- **One database per project** for logical isolation.
- **Extensions per database**, enabled on demand.

### Migrations

Schema is **SQL-first**: versioned `.sql` files are the canonical contract,
applied by Hauldr's migration runner. This mirrors how managed Postgres
platforms work, because RLS policies, functions, and triggers are SQL and an ORM
only gets in the way of expressing them.

On top of that, **Drizzle** provides the typed data layer in the SDK and apps
(queries and types). Hauldr deliberately does not use a migration tool that
fights with row-level security or the pooler.

### The pooler

A multi-tenant connection pooler sits in front of Postgres. It routes each
project to its database and caps connections so that many projects don't
exhaust the server.

> ⚠️ Because it runs in **transaction mode**, the RLS claim must be set as a
> transaction-local setting (per transaction), not per session.

### Tiering

A project starts on the shared cluster. If it grows or becomes critical, it can
be moved to a **dedicated cluster** — the pooler re-points, and the application
does not change. This is the relief valve for noisy-neighbor and fault
isolation.

### Backups

Cluster-level WAL archiving provides point-in-time recovery; per-database dumps
provide granular restore. Restoring a single project's database is a first-class
operation, not an all-or-nothing volume restore.

See [data-plane.md](data-plane.md) for detail.

## Storage

Object/blob storage is a **single shared, S3-compatible store** with **one
bucket per project**. The SDK speaks standard S3 (presigned URLs), which keeps
the storage backend fully pluggable.

File metadata lives as a table in the project's own database, protected by RLS —
so storage access control follows the same model as everything else.

Durability is the operator's responsibility when self-hosting; the recommended
patterns (replication, off-site cold backup, volume snapshots) are covered in
[storage.md](storage.md).

## The SDK

`@hauldr/client` is the cohesion layer. It hides the decomposition behind a
small surface so application developers never touch the pooler or the auth
server directly:

```
hauldr.auth   → GoTrue (lifecycle / OAuth / magic-link / MFA)
hauldr.db     → typed queries through the pooler (injects the RLS claim)
hauldr.files  → upload / signed URL over standard S3
hauldr.live   → shared, multi-tenant Realtime over WebSocket (broadcast / presence / postgres-changes)
```

See [sdk.md](sdk.md).

## Bootstrap & dogfooding

The Hauldr panel **runs as a Hauldr project itself** — it uses Hauldr's own
Postgres, auth, and SDK. That makes it both a real dogfood and a reference
implementation for anyone self-hosting.

This creates a chicken-and-egg problem, solved with **"project zero"**: the
panel's own project (its database and an *admin* auth service) is created by the
installer at bootstrap, not through the UI. From there the panel comes up
authenticated against project zero's auth, and operators create tenant projects
normally.

- **The platform's own auth is just project zero** — its own database and JWT
  secret, isolated from tenants by construction. There is no special "platform"
  auth.
- **The management API authenticates** with an admin JWT (from project zero) for
  the panel, and **service tokens** for machine callers.
- The installer brings up: Postgres + pooler + object store + project zero →
  panel authenticates → operators create tenants.

See [self-hosting.md](self-hosting.md).

## Scale & guardrails

- The pooler keeps connection counts under control.
- Tiering provides noisy-neighbor and fault isolation on demand.
- **The fault domain is honest:** a shared cluster means a shared blast radius;
  anything critical moves to a dedicated tier.
- Observability: Postgres metrics surfaced per-project in the panel.

## Stack of the platform itself

- The panel is a server-rendered web application, deployable on any Docker host.
- The management API talks to the Postgres admin interface, the pooler's admin
  interface, and (when automating deploys) a container orchestrator, to bring up
  per-project auth and REST satellites.

## Open development

Hauldr is developed in the open under the [Apache 2.0](../LICENSE) license. The
open-source surface is the panel, the provisioner, the SDK, and the deployment
recipe for the stack. Upstream components keep their own names; components built
for Hauldr carry Hauldr naming. Documentation is maintained in English.
