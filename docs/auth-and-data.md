# Auth & data

This is the most opinionated part of Hauldr, so it gets its own document. The
short version: **auth is GoTrue, always, per project; row-level security is
always on; data is accessed through server actions by default, with an optional
REST layer.**

## Auth is GoTrue, always

Every project is born with its own [GoTrue](https://github.com/supabase/auth)
instance:

- an **auth schema** in the project's own database, and
- its **own JWT secret**.

This means auth is **isolated per project** — there is no shared identity pool,
and a token issued for one project is meaningless to another.

GoTrue brings the full lifecycle out of the box:

- email/password signup with confirmation
- password reset
- OAuth providers
- magic links
- multi-factor authentication
- standard JWTs with the usual claims

There is no second auth path and no separate "profiles" system to keep in sync.
One model, everywhere.

## Row-level security, always on

Access control is enforced by **Postgres row-level security**, not by
application code. Every table that holds tenant data has RLS policies, and those
policies read the claims from the GoTrue-issued JWT.

The consequence is important: **the same access rules apply no matter how the
data is reached** — through a server action, through the REST layer, or through a
direct query in the SQL editor. There is no code path that can accidentally
bypass them.

```sql
-- Example: users can only see their own rows.
create policy "owner can read"
  on documents for select
  using ( owner_id = (auth.jwt() ->> 'sub')::uuid );
```

## Two ways to reach data

### Server actions (default)

By default, an application reaches its data by talking to Postgres through the
pooler from server-side code. The Hauldr data layer **injects the auth claim per
transaction** so RLS policies can see who is asking:

```
set_config('request.jwt.claims', <claims-json>, true)  -- transaction-local
```

The `true` argument makes the setting **transaction-local**. This matters
because the pooler runs in transaction mode — a session-level setting would leak
across pooled connections, but a transaction-local one is scoped to exactly the
work being done.

The SDK does this for you; application code just runs a query.

### REST API (à-la-carte)

Some projects want a raw REST API exposed to the outside world. For those, a
[PostgREST](https://postgrest.org/) satellite can be enabled per project. With
PostgREST the claim injection is **automatic** — it reads the JWT and sets the
claim itself, and the same RLS policies apply.

The REST layer is **opt-in**. A project that only needs server-side access never
runs it.

| Composition    | Services                       | Notes                       |
| -------------- | ------------------------------ | --------------------------- |
| **Default**    | app + auth + database          | server actions, RLS-guarded |
| **+ REST API** | app + auth + REST + database   | adds an external REST surface|

## Why this model

- **Defense lives in one place.** Because RLS is always on and reads the JWT, the
  database is the single source of truth for access control. You don't have to
  trust every code path to re-check permissions.
- **No auth sprawl.** One auth server per project, with a clear boundary, beats a
  patchwork of bespoke auth and profile tables.
- **REST is a feature, not a tax.** Projects that need a public REST API get one;
  projects that don't, don't pay for it.

## What this is *not*

- It is **not** a custom auth server. GoTrue is used as-is.
- It is **not** application-enforced authorization. If a rule matters, it is an
  RLS policy.
- It is **not** a shared identity provider across projects. Each project's auth
  is its own island.
