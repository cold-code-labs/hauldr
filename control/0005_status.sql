-- Provisioning lifecycle. A project is 'provisioning' from the moment it is
-- registered until its sidecars (GoTrue, and PostgREST when requested) are
-- actually healthy, then 'live'; 'error' if provisioning failed (detail in
-- status_detail). This is what the panel polls to show a project coming up.
alter table projects add column if not exists status text not null default 'live';
alter table projects add column if not exists status_detail text;
-- Whether REST (PostgREST) was requested at create time — so the panel can show
-- the REST sidecar as 'provisioning' before its url exists yet.
alter table projects add column if not exists rest_requested boolean not null default false;
