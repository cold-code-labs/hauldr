import { config } from "./config";

/**
 * Preflight — read-only inventory of a source Supabase project via its
 * Management API (a Personal Access Token, `sbp_…`). The first gate of
 * `migrate-in`: produces a go/no-go report of what migrates and what is left
 * behind (extensions stripped, edge functions, cron jobs). Mirrors the manual
 * preflight proven on Viken; see the playbook (Edda pilares/hauldr-migracao).
 *
 * The Supabase MCP needs interactive OAuth (401 headless) — the Management API
 * with a PAT is the headless path. SQL endpoint:
 *   POST https://api.supabase.com/v1/projects/{ref}/database/query  { query }
 */

export type Preflight = {
  ref: string;
  pgVersion: string;
  counts: {
    tables: number;
    policies: number;
    functions: number;
    triggers: number;
    authUsers: number;
    buckets: number;
    storageObjects: number;
  };
  /** Extensions present on the source; `missing` are the ones the Hauldr PG
   *  image lacks (their `CREATE EXTENSION` lines must be stripped on restore). */
  extensions: string[];
  missingExtensions: string[];
  /** pg_cron jobs (become systemd timers — the Functions Plane cron, not pg_cron). */
  cronJobs: { jobname: string; schedule: string }[];
  /** Edge functions ACTUALLY DEPLOYED (the source of truth — the repo drifts). */
  deployedFunctions: string[];
  /** Cosmetic go/no-go: hard blockers (none expected — the gotchas are handled). */
  warnings: string[];
};

// Extensions the Hauldr multi-tenant PG image does NOT provide → strip on restore.
const MISSING_EXTENSIONS = new Set(["pg_cron", "pg_net", "supabase_vault"]);

const MGMT = "https://api.supabase.com/v1";

async function sql<T = Record<string, unknown>>(
  ref: string,
  pat: string,
  query: string,
): Promise<T[]> {
  const r = await fetch(`${MGMT}/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!r.ok) throw new Error(`management API SQL ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return (await r.json()) as T[];
}

export async function preflightSource(ref: string, pat = config.migratePat): Promise<Preflight> {
  if (!pat) throw new Error("no Supabase PAT (set HAULDR_MIGRATE_PAT or pass one)");

  const [counts] = await sql<{
    tables: number; policies: number; functions: number; triggers: number;
    auth_users: number; buckets: number; storage_objects: number; pg_version: string;
  }>(ref, pat, `select
    (select count(*)::int from information_schema.tables where table_schema='public' and table_type='BASE TABLE') as tables,
    (select count(*)::int from pg_policies where schemaname='public') as policies,
    (select count(*)::int from information_schema.routines where routine_schema='public' and routine_type='FUNCTION') as functions,
    (select count(distinct trigger_name)::int from information_schema.triggers where trigger_schema='public') as triggers,
    (select count(*)::int from auth.users) as auth_users,
    (select count(*)::int from storage.buckets) as buckets,
    (select count(*)::int from storage.objects) as storage_objects,
    (select split_part(version(),' on ',1)) as pg_version`);

  const exts = await sql<{ extname: string }>(ref, pat,
    "select extname from pg_extension order by extname");
  const extensions = exts.map((e) => e.extname);
  const missingExtensions = extensions.filter((e) => MISSING_EXTENSIONS.has(e));

  const cron = await sql<{ jobname: string; schedule: string }>(ref, pat,
    "select jobname, schedule from cron.job order by jobid").catch(() => []);

  const fr = await fetch(`${MGMT}/projects/${ref}/functions`, {
    headers: { Authorization: `Bearer ${pat}` },
  });
  const deployedFunctions = fr.ok
    ? ((await fr.json()) as { slug: string }[]).map((f) => f.slug).sort()
    : [];

  const warnings: string[] = [];
  if (counts.pg_version.includes("17") && config.edgeRuntimeImage) {
    // PG17 source → pg16 target: only `SET transaction_timeout` needs stripping.
    warnings.push("source is PG17; strip `SET transaction_timeout` on restore (target hauldr-db is pg16)");
  }
  if (deployedFunctions.length) {
    warnings.push(`${deployedFunctions.length} edge function(s) deployed — pull the DEPLOYED source (eszip), NOT the git repo (it drifts)`);
  }

  return {
    ref,
    pgVersion: counts.pg_version,
    counts: {
      tables: counts.tables, policies: counts.policies, functions: counts.functions,
      triggers: counts.triggers, authUsers: counts.auth_users,
      buckets: counts.buckets, storageObjects: counts.storage_objects,
    },
    extensions, missingExtensions, cronJobs: cron, deployedFunctions, warnings,
  };
}

/** Human-readable go/no-go report. */
export function formatPreflight(p: Preflight): string {
  const c = p.counts;
  return [
    `Preflight — source ${p.ref} (${p.pgVersion})`,
    `  tables=${c.tables} policies=${c.policies} functions=${c.functions} triggers=${c.triggers}`,
    `  auth.users=${c.authUsers} buckets=${c.buckets} objects=${c.storageObjects}`,
    `  extensions: ${p.extensions.join(", ")}`,
    `  ⚠️ strip on restore: ${p.missingExtensions.join(", ") || "(none)"}`,
    `  cron jobs (→ systemd timers): ${p.cronJobs.map((j) => `${j.jobname}@${j.schedule}`).join(", ") || "(none)"}`,
    `  edge functions deployed (${p.deployedFunctions.length}): ${p.deployedFunctions.join(", ") || "(none)"}`,
    ...p.warnings.map((w) => `  • ${w}`),
    `  → GO (gotchas handled in migrate-in; see playbook)`,
  ].join("\n");
}
