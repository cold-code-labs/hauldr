-- Shared Realtime (à-la-carte): broadcast / presence / postgres-changes over
-- WebSocket. Unlike auth/REST, Realtime is NOT per-project — one shared service
-- serves every project, each registered as a Realtime "tenant" via its mgmt API.
-- A project opts in (services/realtime); we keep its public Realtime host + the
-- tenant external_id so the SDK can connect and teardown is idempotent.
alter table projects add column if not exists realtime_url text;
alter table projects add column if not exists realtime_external_id text;
