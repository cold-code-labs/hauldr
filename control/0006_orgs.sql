-- Organizations — the tenant grouping that sits above projects. The first one
-- is created at first-run (the installer's "tenant zero"); operators can create
-- more later. Every project belongs to exactly one organization.
create table if not exists organizations (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  slug       text not null unique,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

-- At most one default organization (tenant zero) — a partial unique index on the
-- truthy value enforces it without blocking the many is_default = false rows.
create unique index if not exists organizations_one_default
  on organizations (is_default) where is_default;

-- Projects belong to an organization. Nullable for a clean additive migration on
-- an existing install; the bootstrap adopts any orphans into the default org.
alter table projects add column if not exists organization_id uuid references organizations (id);
create index if not exists projects_organization_id_idx on projects (organization_id);
