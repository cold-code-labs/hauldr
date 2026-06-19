-- Pooler wiring: persist what's needed to (re)register a project's Supavisor
-- tenant — the authenticator password and the tenant's external id.
alter table projects add column if not exists db_password text;
alter table projects add column if not exists tenant_external_id text;
