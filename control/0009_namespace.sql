-- Project namespace + environment. A project now belongs to a logical identity
-- (`base_name`) and an environment (`env`: prod | dev). Public endpoints are
-- served under one host per identity — `<base>.hauldr.<zone>` — with the
-- environment selected by a path segment (prod at the root, dev under `/dev`)
-- and the service under `/auth` | `/rest`. So `ufc` (prod) and `ufc_dev` (dev)
-- share `ufc.hauldr.<zone>`, differing only by the `/dev` prefix — one identity,
-- one URL + key per environment.
--
-- Back-compat backfill follows the `<base>_dev` naming convention: a project
-- whose name ends in `_dev` is the dev environment of `<base>`; everything else
-- is its own prod identity.
alter table projects add column if not exists env text not null default 'prod';
alter table projects add column if not exists base_name text;

alter table projects drop constraint if exists projects_env_check;
alter table projects add constraint projects_env_check check (env in ('prod', 'dev'));

update projects
  set env = case when name like '%\_dev' escape '\' then 'dev' else 'prod' end,
      base_name = case
        when name like '%\_dev' escape '\' then left(name, length(name) - 4)
        else name
      end
  where base_name is null;
