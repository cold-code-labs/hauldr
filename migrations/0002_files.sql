-- File metadata — applied to every NEW project database.
--
-- The object store (S3/Garage) holds the bytes; THIS table holds the truth about
-- who may touch them, guarded by the same RLS as the rest of the data. Mirrors
-- Supabase's storage-objects model without running a per-project storage service:
-- listing/querying files is just SQL, and access control is the same `sub`-keyed
-- RLS as everything else. The SDK's `hauldr.files` moves bytes; the app records a
-- row here per object (path = `${group}/${key}` in the project's bucket).

create table if not exists files (
  id           uuid primary key default gen_random_uuid(),
  owner        uuid not null default hauldr.current_user_id(),
  group_name   text not null,
  path         text not null unique,
  name         text,
  content_type text,
  size         bigint,
  created_at   timestamptz not null default now()
);

alter table files enable row level security;

create policy files_owner_select on files
  for select to authenticated
  using (owner = hauldr.current_user_id());

create policy files_owner_modify on files
  for all to authenticated
  using (owner = hauldr.current_user_id())
  with check (owner = hauldr.current_user_id());

grant select, insert, update, delete on files to authenticated;
grant select on files to anon;
