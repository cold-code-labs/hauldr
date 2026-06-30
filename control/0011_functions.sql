-- Per-project Functions Plane (à-la-carte): the optional supabase/edge-runtime
-- layer serving the project's edge functions at `/functions/v1`. Opt-in like
-- REST/Storage — only projects migrated from a Supabase with edge functions turn
-- it on. The function source lives on the docker host (config.functionsDir); these
-- columns track the running sidecar.
alter table projects add column if not exists functions_url text;
alter table projects add column if not exists functions_container text;
