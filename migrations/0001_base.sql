-- Hauldr base schema — applied to every NEW project database.
--
-- RLS keyed to the JWT 'sub' claim. The app connects as the project's
-- authenticator role and `SET ROLE authenticated` (a NON-owner role) per
-- transaction, then injects the claims via set_config(...). Because the
-- acting role is neither the table owner nor a superuser, the policies
-- actually apply.
--
--   begin;
--   set local role authenticated;
--   select set_config('request.jwt.claims', '{"sub":"<uuid>"}', true);
--   ... queries ...
--   commit;
--
-- 'sub' is exactly the claim a GoTrue access token carries, so the same
-- policies hold whether the claim is injected by the SDK (server actions) or
-- presented as a GoTrue-issued JWT (a REST layer).

create extension if not exists pgcrypto;
create schema if not exists hauldr;

create or replace function hauldr.current_user_id() returns uuid
  language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::json ->> 'sub', '')::uuid;
$$;

-- Demo table — the starting point every new project gets so it is testable
-- end-to-end (auth → RLS → data) the moment it is provisioned. Replace it with
-- your own migrations.
create table if not exists todos (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null default hauldr.current_user_id(),
  title      text not null,
  done       boolean not null default false,
  created_at timestamptz not null default now()
);

alter table todos enable row level security;

create policy todos_owner_select on todos
  for select to authenticated
  using (owner = hauldr.current_user_id());

create policy todos_owner_modify on todos
  for all to authenticated
  using (owner = hauldr.current_user_id())
  with check (owner = hauldr.current_user_id());

-- Privileges for the shared non-owner roles (RLS gates the rows).
grant usage on schema public, hauldr to anon, authenticated;
grant execute on all functions in schema hauldr to anon, authenticated;
grant select, insert, update, delete on todos to authenticated;
-- anon gets table-level SELECT too, so an anonymous REST/SDK read reaches the
-- table and RLS returns an empty set (200), rather than a table-level 401. The
-- `alter default privileges` below only covers tables created AFTER it, so the
-- pre-existing `todos` must be granted explicitly to match that intent.
grant select on todos to anon;

alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant select on tables to anon;

-- Realtime: the shared multi-tenant Realtime service runs its OWN per-tenant
-- migrations inside this database (creating realtime.messages/subscription/…) the
-- first time the project is registered as a tenant. Those migrations connect with
-- search_path=realtime and cannot create the schema themselves, so it must already
-- exist. Pre-create it here (owned by postgres) for every project; it stays empty
-- and harmless until the project opts into realtime.
create schema if not exists realtime authorization postgres;
