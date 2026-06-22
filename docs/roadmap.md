# Roadmap

Hauldr is built in phases. Each phase is shippable and unlocks the next. The
foundational architecture is settled; what follows is delivery order, not open
design questions.

## Phases

| Phase  | Deliverable | Status |
| ------ | ----------- | ------ |
| **P0** | Postgres + multi-tenant pooler running; multi-tenant pooling proven with two databases. | ✅ shipped |
| **P1** | Minimal management API: `createProject` (CREATE DATABASE + role + pooler route + migrations + bring up the project's auth + JWT secret), connection string, working auth. External provisioning can call it. | ✅ shipped |
| **P2** | Panel v1: projects, SQL editor, table editor, auth & users, connection string / keys. | ✅ shipped |
| **P3** | RLS policy editor + à-la-carte REST layer (per-project toggle for projects that want a raw REST API). | ✅ shipped |
| **P4** | Backups / point-in-time recovery, multi-cluster tiering, logs, per-project metrics, and open-source polish (docs, deployment recipe). | 🚧 in progress |

**P0–P3 are shipped.** The control plane provisions projects end-to-end (auth
always; REST, storage, and realtime à-la-carte), exposes a Supabase-dialect
data-plane gateway (`<base>.hauldr/{auth,rest}`, environment by host), a
self-service schema-migrate endpoint, and storage via `storage-api`. The whole
CCL fleet runs on it. What remains (**P4**) is operational polish: backups /
PITR, multi-cluster tiering, per-project metrics and logs in the panel, and the
`hauldr migrate` one-click import path.

## Settled decisions

These are closed; listed here so the rationale is on record.

- **Auth** → GoTrue, one per project, always. No alternative auth path.
- **Access control** → row-level security, always on.
- **Data access** → server actions by default; REST layer à-la-carte.
- **Storage** → shared S3-compatible object store, one bucket per project.
- **Realtime** → a single shared, multi-tenant Realtime service (each project is a
  tenant). Broadcast over WebSocket is the primary model — including app-driven
  broadcast (a server action publishes after a write) and private channels gated by
  RLS on `realtime.messages`. `postgres-changes` (CDC) is optional and needs a
  Postgres build with the `wal2json` output plugin (shipped in `deploy/postgres`).
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

`hauldr migrate` — a one-click import path that lifts an existing project
(schema + auth users + storage) into a Hauldr project, validated live against a
real migration. This is the remaining moat piece on top of the shipped P0–P3
foundation.
