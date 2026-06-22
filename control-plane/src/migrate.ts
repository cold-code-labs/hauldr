import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import type pg from "pg";
import { dbClient } from "./db";

/**
 * Apply every *.sql file in `dir` (lexical order) to the connected client,
 * tracked in `_hauldr_migrations`. Idempotent: already-applied files are skipped.
 * Returns the list of files applied this run.
 */
export async function applyMigrations(
  client: pg.Client,
  dir: string,
): Promise<string[]> {
  await client.query(
    `create table if not exists _hauldr_migrations (
       name       text primary key,
       applied_at timestamptz not null default now()
     )`,
  );

  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  const applied: string[] = [];

  for (const file of files) {
    const { rowCount } = await client.query(
      "select 1 from _hauldr_migrations where name = $1",
      [file],
    );
    if (rowCount) continue;

    const sql = await readFile(path.join(dir, file), "utf8");
    await client.query("begin");
    try {
      await client.query(sql);
      await client.query("insert into _hauldr_migrations(name) values ($1)", [
        file,
      ]);
      await client.query("commit");
      applied.push(file);
    } catch (err) {
      await client.query("rollback");
      throw err;
    }
  }

  return applied;
}

/**
 * Apply ONE SQL migration to a project's database, tracked + idempotent. Connects
 * as the admin/owner (so DDL is allowed and RLS is bypassed) and records applied
 * migrations in `_app_migrations`, so re-sending the same `name` is a no-op. This
 * is the self-service schema path: the project DB is internal-only by design (no
 * public Postgres), so an app's `db/migrations/NNNN_*.sql` reach it through this
 * (POST /v1/projects/:name/migrate) instead of a public connection string.
 *
 * `search_path` is forced to `public` for the migration body: a project DB has
 * `search_path = auth, public` (set for GoTrue), so an unqualified `create table`
 * would otherwise land in `auth`. App DDL belongs in `public`.
 */
export async function migrateProject(
  project: string,
  sql: string,
  name?: string,
): Promise<{ applied: boolean; name: string }> {
  const migrationName =
    name?.trim() ||
    `inline_${crypto.createHash("sha256").update(sql).digest("hex").slice(0, 16)}`;
  const c = dbClient(`db_${project}`);
  await c.connect();
  try {
    await c.query(
      `create table if not exists _app_migrations (
         name text primary key,
         applied_at timestamptz not null default now()
       )`,
    );
    const { rowCount } = await c.query(
      "select 1 from _app_migrations where name = $1",
      [migrationName],
    );
    if (rowCount) return { applied: false, name: migrationName };

    await c.query("begin");
    try {
      await c.query("set local search_path = public");
      await c.query(sql);
      await c.query("insert into _app_migrations(name) values ($1)", [migrationName]);
      await c.query("commit");
    } catch (err) {
      await c.query("rollback");
      throw err;
    }
    return { applied: true, name: migrationName };
  } finally {
    await c.end();
  }
}
