-- Hauldr control database schema (the `hauldr` system db).
-- Registry of provisioned projects.

create extension if not exists pgcrypto;

create table if not exists projects (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  database   text not null,
  role       text not null,
  created_at timestamptz not null default now()
);
