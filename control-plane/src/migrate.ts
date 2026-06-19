import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type pg from "pg";

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
