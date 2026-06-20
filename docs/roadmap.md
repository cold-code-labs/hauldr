# Roadmap

Hauldr is built in phases. Each phase is shippable and unlocks the next. The
foundational architecture is settled; what follows is delivery order, not open
design questions.

## Phases

| Phase  | Deliverable |
| ------ | ----------- |
| **P0** | Postgres + multi-tenant pooler running; multi-tenant pooling proven with two databases. |
| **P1** | Minimal management API: `createProject` (CREATE DATABASE + role + pooler route + migrations + bring up the project's auth + JWT secret), connection string, working auth. External provisioning can call it. |
| **P2** | Panel v1: projects, SQL editor, table editor, auth & users, connection string / keys. |
| **P3** | RLS policy editor + à-la-carte REST layer (per-project toggle for projects that want a raw REST API). |
| **P4** | Backups / point-in-time recovery, multi-cluster tiering, logs, per-project metrics, and open-source polish (docs, deployment recipe). |

**P0 + P1** are the milestone that matters first: they take new applications off
the ceiling of a single-file embedded database, **already with proper auth and
row-level security**. The optional REST layer (P3) is the only remaining
per-project satellite after that.

## Settled decisions

These are closed; listed here so the rationale is on record.

- **Auth** → GoTrue, one per project, always. No alternative auth path.
- **Access control** → row-level security, always on.
- **Data access** → server actions by default; REST layer à-la-carte.
- **Storage** → shared S3-compatible object store, one bucket per project.
- **Realtime** → a single shared, multi-tenant Realtime service (each project is a
  tenant). Broadcast + presence over WebSocket are the primary model — including
  app-driven broadcast (a server action publishes after a write). `postgres-changes`
  (CDC) is optional and needs a Postgres build with the `wal2json` output plugin.
- **License** → Apache 2.0; public repository from day one.
- **Dogfooding** → the panel runs as a Hauldr project, bootstrapped via project
  zero.
- **Postgres** → runs inside the stack (portable), one database per project.
- **Migrations** → SQL-first, with a typed layer (Drizzle) on top. No ORM-driven
  migrations.
- **Platform / API auth** → project zero + service tokens.

## Open questions

These are genuinely undecided and tracked as issues:

- **Storage extras** — keep image transforms / resumable uploads thin in the SDK,
  or adopt a dedicated storage service later?
- **Alternative object-store backends** — which S3-compatible stores to validate
  as drop-in alternatives.

## Next concrete step

Specify the contract of the management API (`createProject`) and the bootstrap
recipe for the stack (Postgres + pooler + object store + project zero).
