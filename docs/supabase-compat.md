# Supabase compatibility

Hauldr already runs the same core components Supabase does — GoTrue (auth),
PostgREST (rest), Realtime, and `storage-api` over Garage — and the namespace
gateway already serves the Supabase `/v1` dialect beside Hauldr's native paths.
This document is the plan to take that from "the core surfaces match" to a
genuine **drop-in Supabase replacement**: an unmodified `supabase-js` app, and
the `supabase` CLI / Studio, work against a Hauldr project.

> Goal restated: maximize Supabase compatibility as a *product* capability.
> This is **not** a migration project for any one app — see "Viken as the
> conformance spec" below.

## Where we are (compatibility matrix)

Verified against the live fleet and both codebases (2026-06).

| Surface | Status | Notes |
| --- | --- | --- |
| Auth (GoTrue) | ✅ HAS | GoTrue v2.190.0, one per project. Email/password, magic-link, MFA. |
| REST (PostgREST) | ✅ HAS | v12.2.3, à-la-carte, RLS-enforcing. |
| Realtime | ✅ HAS | Broadcast + presence + postgres-changes (CDC), shared multi-tenant service. |
| Storage | ✅ HAS | `supabase/storage-api` v1.60.4 over Garage. Image transforms disabled. |
| RLS | ✅ HAS | Always on. |
| Postgres functions / RPC | ✅ HAS | Exposed via PostgREST. |
| `/v1` dialect aliases | ✅ HAS | Gateway dual-mounts `/<service>` + `/<service>/v1` for auth/rest/realtime/storage (`routeDomainsFor`). `supabase-js` resolves today. Verified live: `/auth/v1/*`, `/rest/v1/*` → 200. |
| **Supabase roles + `auth.*()` helpers** | ⚠️ VERIFY/PARTIAL | RLS policies in Supabase apps call `auth.uid()` / `auth.role()` / `auth.jwt()` and assume roles `anon` / `authenticated` / `service_role` / `authenticator`. Must exist for policies to port unedited. |
| anon / service_role keys + `apikey` header | ⚠️ VERIFY | Minted; confirm claim shape (`role`, `aud`) + header handling are byte-identical to Supabase. |
| **Edge Functions (`/functions/v1`, Deno)** | ❌ MISSING | No runtime. The headline gap. |
| **DB webhooks (`pg_net`)** | ❌ MISSING | No outbound HTTP from Postgres. |
| **Cron (`pg_cron`)** | ❌ MISSING | No in-DB scheduling. |
| GraphQL (`pg_graphql`, `/graphql/v1`) | ❌ MISSING | Minor. |
| Vault (`supabase_vault` / `pgsodium`) | ❌ MISSING | Minor. |
| Supabase CLI (`link` / `db push` / `functions deploy`) | ❌ MISSING | Adoption multiplier. |
| Supabase Studio | ❌ MISSING | Hauldr has its own panel; Studio-pointing is a compat nicety. |

## The foundational insight

Most gaps trace to **one** root cause: Hauldr provisions project databases on
`postgres:16-alpine`, while Supabase runs `supabase/postgres`. That image is why
we lack `pg_net`, `pg_cron`, `pgsodium`, `pg_graphql`, and likely the roles +
`auth.*()` helper functions every Supabase RLS policy references. Default
extensions on a Hauldr project DB today: only `pgcrypto` (`migrations/0001_base.sql`).

**Close the substrate gap first and half the matrix closes with it.** The rest
is a runtime (edge functions) and tooling (CLI / Studio).

## The plan

Ordered by leverage. Each phase is shippable and has a definition of done tied
to the conformance fixture.

### Phase 0 — Compat contract + conformance harness *(days)*
- This document, kept current as the tracked contract.
- A **conformance fixture** derived from a real Supabase app's usage (Viken):
  its schema + RLS + RPC + scripted exercises of auth flows, realtime, storage,
  and a representative slice of edge functions, run against a throwaway Hauldr
  project. This is the definition of done for every later phase.
- **DoD:** fixture runs green/red against a Hauldr project and reports per-surface pass/fail.

### Phase 1 — Postgres substrate parity *(the big unlock)*
Split by risk:
- **1a — SQL-only, any image, quick win.** Create Supabase roles (`anon`,
  `authenticated`, `service_role`, `authenticator`), the `auth.uid()` /
  `auth.role()` / `auth.jwt()` helper functions, and the standard default
  extension set that ships with stock Postgres (`uuid-ossp`, `pgcrypto`,
  `pg_trgm`). **This makes Supabase RLS policies + RPC port with zero edits** —
  they all call `auth.uid()`.
- **1b — image swap.** Move project DBs to `supabase/postgres` (bundles
  `pg_net`, `pg_cron`, `pgsodium`, `pg_graphql`, `vector`).
  ⚠️ Substrate change for the existing fleet on the shared instance — roll out
  to *new* projects first / behind a maintenance window, never a blind swap.
- Confirm anon / service_role JWT claims + `apikey` header behave identically so
  `supabase-js` works unchanged.
- **DoD:** the fixture's full schema + RLS + RPC apply and pass on a Hauldr
  project with **no policy rewrites**.

### Phase 2 — Edge Functions (`/functions/v1`)
- Shared `supabase/edge-runtime` service; add `"functions"` to `ServiceKind`;
  a deploy endpoint (`POST /v1/projects/:name/functions`) + per-function
  secrets. The gateway already dual-mounts `/<service>/v1`, so
  `supabase.functions.invoke()` resolves with no client change.
- **DoD:** a representative function (e.g. an `auth.admin.createUser` bootstrap
  and an inbound payment webhook) deploys and runs against Hauldr.

### Phase 3 — Webhooks + Cron *(mostly free after 1b)*
- `pg_net` (DB → HTTP) for database webhooks via the `supabase_functions.http_request`
  trigger helper; `pg_cron` for scheduled jobs. Both ship with the 1b image.
- Note: `pg_net` is **outbound** only — inbound webhooks still need the Phase-2
  runtime to receive them.
- **DoD:** a row-change fires a `pg_net` POST; a `pg_cron` job runs on schedule.

### Phase 4 — Tooling / ecosystem compat *(the adoption multiplier)*
- **Supabase CLI:** `supabase link`, `db push` / `db pull`, `functions deploy`
  against a Hauldr project — turns "compatible" into "frictionless to adopt".
- **Supabase Studio** pointed at a Hauldr project (data browser, SQL editor,
  auth users, storage), for teams who expect it.
- **DoD:** `supabase db push` + `supabase functions deploy` succeed; Studio loads a project.

### Phase 5 — Parity polish
- `pg_graphql` (`/graphql/v1`), Vault, storage image transforms (currently
  hard-disabled), auth OAuth providers + auth hooks.

## Sequencing logic

Phase 0 defines done → Phase 1 removes the substrate root-cause → Phase 2 fills
the headline missing service → Phase 3 falls out of 1b nearly free → Phase 4 is
the adoption multiplier → Phase 5 is completeness. **Phase 1a is a cheap,
high-value first strike** (RLS/RPC portability) independent of the riskier image
swap, and is the recommended starting point next session.

## Viken as the conformance spec (not a migration)

Viken is a real, paying Supabase app (client funds the cloud bill, so there is
**no migration urgency**). That makes it the ideal **conformance oracle**: read
its codebase, turn its actual backend usage into the Phase-0 fixture, and build
Hauldr-compat until a *copy* of its backend runs unchanged on Hauldr — without
ever touching the client's live instance.

What Viken exercises, and which phase covers it:

| Viken usage | Count | Covered by |
| --- | --- | --- |
| Auth: email/password, magic-link, sessions, `auth.admin.*` | — | HAS / Phase 1a (helpers) |
| RLS via `auth.uid()` + tenant scoping | ~all tables | Phase 1a |
| Triggers (`SECURITY DEFINER`) | 8 | HAS (plain Postgres) |
| RPC (PL/pgSQL, incl. `get_available_slots`) | 5+ | HAS |
| Realtime (`postgres_changes`) | 1 subscription | HAS |
| Storage buckets | 2 | HAS |
| **Edge Functions (Deno)** | 24 | Phase 2 |
| Inbound payment webhook (Vindi) | 1 | Phase 2 |
| Scheduled scans | ~4 | Phase 3 (`pg_cron`) + Phase 2 |

The 24 functions decompose into three needs, not 24 problems: **privileged
auth-admin glue** (~11; `auth.admin.*` + profile/role writes), **inbound webhook
+ external API** (~5; Vindi), and **scheduled batch** (~5). Phases 2–3 cover all
three.

## Out of scope / non-goals

- Migrating any production app as part of this work. Compat is validated against
  a *copy* of the conformance fixture only.
- Replacing Hauldr's own panel/SDK. Native paths and `@hauldr/client` stay; the
  Supabase dialect is served *beside* them (the dual-mount already does this).

## Status

Planning only. Implementation begins in a later session, starting with Phase 1a.
See `docs/roadmap.md` for the broader P0–P4 product roadmap (`hauldr migrate`
lives in P4 and is the natural companion to this compat work).
