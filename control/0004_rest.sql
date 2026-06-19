-- Per-project PostgREST (à-la-carte): the optional REST data layer. Unlike auth
-- (one GoTrue per project, always), PostgREST is opt-in — only projects that
-- want a raw REST API over their data turn it on. It reuses the project's
-- authenticator role and GoTrue JWT secret, so RLS holds identically whether
-- data is reached through server actions or this REST endpoint.
alter table projects add column if not exists postgrest_url text;
alter table projects add column if not exists postgrest_container text;
