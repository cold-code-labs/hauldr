# Fleet jobs worker

A single, **shared** background-job runner for the whole fleet — cron + durable
jobs on [pg-boss](https://github.com/timgit/pg-boss). Unlike auth/REST it is
**not** per-project: one worker serves every project (like Realtime).

## Model

- **Store** — its own database (`hauldr_jobs`) on the shared cluster. The control
  plane ensures the `fleet_worker` login role + that database (which the role
  **owns**, so pg-boss can create its `pgboss` schema) at bootstrap. See
  `control-plane/src/bootstrap.ts` (`ensureJobsStore`).
- **Connection** — **direct** to Postgres (`hauldr-db:5432`), not the pooler.
  pg-boss needs session-level `LISTEN/NOTIFY`, which the transaction-mode pooler
  doesn't carry — and an infra worker doesn't need RLS-bound tenant routing.
- **Deploy** — a stack service in `docker-compose.prod.yml` (`worker`). No inbound
  HTTP → no ports, no domain.

## Adding a job

1. Create `src/jobs/<name>.ts` exporting a `FleetJob`:
   ```ts
   import type { FleetJob } from "./types";
   export const myJob: FleetJob = {
     name: "my-job",
     cron: "0 * * * *", // optional; omit for enqueue-only jobs
     run: async () => {
       /* idempotent work */
     },
   };
   ```
2. Register it in `src/jobs/index.ts`.

Throwing from `run` triggers pg-boss retry/backoff, so every run should be
idempotent.

## Jobs

| Job                      | Schedule        | What it does                                                                                            |
| ------------------------ | --------------- | ------------------------------------------------------------------------------------------------------ |
| `brokk-access-reconcile` | `*/15 * * * *`  | Grants the review bot (`brokk-ccl`) `push` on every active org repo, minus a denylist. Idempotent.     |

## Env

See the **Fleet jobs** block in the repo-root `.env.example`. Key vars:
`DATABASE_URL` (the pg-boss store), `GH_ADMIN_TOKEN`, `GH_ORG`, `GH_BOT`,
`GH_BOT_DENYLIST`.

## Local dev

```sh
pnpm install
DATABASE_URL=postgres://fleet_worker:<pw>@localhost:5433/hauldr_jobs pnpm dev
```
