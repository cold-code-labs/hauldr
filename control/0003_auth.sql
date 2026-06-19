-- Per-project auth (GoTrue): its own JWT secret, endpoint, and container handle.
-- One GoTrue per project, always — the canonical Hauldr auth model. The secret
-- lives in the control db so re-provisioning is idempotent and tokens stay
-- valid across restarts.
alter table projects add column if not exists jwt_secret text;
alter table projects add column if not exists gotrue_url text;
alter table projects add column if not exists gotrue_container text;
