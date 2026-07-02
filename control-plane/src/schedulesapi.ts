import { cronAdminClient } from "./db";

/**
 * Schedules — the Cron plane. A schedule is a named recurring job for a project,
 * registered centrally (one shared pg_cron scheduler) and executed either inside
 * the project's own database or as an outbound HTTP call. This is the substrate
 * the fleet's hand-written `hauldr-fn-*` systemd timers migrate onto: no per-job
 * unit, no SSH — the control plane owns registration; execution stays in the app
 * (an HTTP endpoint / edge function) or in the tenant DB (SQL).
 *
 * Two kinds:
 *  - "http" — call a URL on schedule via pg_net (`net.http_post`/`net.http_get`).
 *    Registered in the cron database (where pg_net's worker runs). This is the
 *    "call my app / edge function on schedule" case — the caller supplies the URL
 *    and any auth headers (e.g. a cron secret); the control plane never needs the
 *    app's secret. Mirrors Supabase's pg_cron → net.http_post → edge-function.
 *  - "sql" — run SQL inside the project's database (`db_<name>`) via
 *    `cron.schedule_in_database`. For DB-native work: enqueue to pgmq, refresh a
 *    materialized view, sweep stale rows.
 *
 * Jobs live in the shared `cron.job` catalog namespaced `"<project>__<name>"`, so
 * one tenant can never see or clobber another's. Requires the pg_cron substrate
 * (Hauldr on `supabase/postgres`); on a cluster without it, create() fails with a
 * clear message rather than half-registering.
 */

const PROJECT = /^[a-z][a-z0-9_]{1,40}$/;
const JOB = /^[a-z][a-z0-9_-]{0,62}$/;

export type ScheduleKind = "http" | "sql";

export type ScheduleSpec = {
  /** Logical schedule name, unique per project (`[a-z][a-z0-9_-]`). */
  name: string;
  /** Cron expression (`0 6 * * *`) or interval (`30 seconds`) — passed to pg_cron. */
  schedule: string;
  /** Inferred from the payload when omitted: `url` ⇒ http, `command` ⇒ sql. */
  kind?: ScheduleKind;
  active?: boolean;

  // http
  url?: string;
  method?: "POST" | "GET";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;

  // sql
  command?: string;
};

export type Schedule = {
  project: string;
  name: string;
  jobid: number;
  kind: ScheduleKind;
  schedule: string;
  database: string;
  active: boolean;
};

function ident(s: string) {
  return "'" + s.replace(/'/g, "''") + "'"; // used as a text literal, not an identifier
}
function jobName(project: string, name: string) {
  return `${project}__${name}`;
}
function kindOf(command: string): ScheduleKind {
  return /\bnet\.http_(post|get)\b/i.test(command) ? "http" : "sql";
}

/** Ensure the cron substrate exists in the cron database (idempotent). */
async function ensureSubstrate(admin: pgClient, needNet: boolean) {
  try {
    await admin.query("create extension if not exists pg_cron");
    if (needNet) await admin.query("create extension if not exists pg_net");
  } catch (e) {
    throw new Error(
      "scheduling requires the pg_cron/pg_net substrate — this project's cluster " +
        `does not provide it (${(e as Error).message}). Onboard it to a Hauldr 17 ` +
        "cluster (supabase/postgres) first.",
    );
  }
}
type pgClient = ReturnType<typeof cronAdminClient>;

/** Build the SQL a pg_net http job runs. Values are inlined as escaped literals
 *  because pg_cron stores the command as text (no bind params at fire time). */
function httpCommand(spec: ScheduleSpec): string {
  const url = spec.url!;
  const headers = JSON.stringify(spec.headers ?? {});
  const timeout = Math.max(1000, Math.min(spec.timeoutMs ?? 5000, 300000));
  if ((spec.method ?? "POST") === "GET") {
    return `select net.http_get(url:=${ident(url)}, headers:=${ident(headers)}::jsonb, timeout_milliseconds:=${timeout})`;
  }
  const body = JSON.stringify(spec.body ?? {});
  return `select net.http_post(url:=${ident(url)}, body:=${ident(body)}::jsonb, headers:=${ident(headers)}::jsonb, timeout_milliseconds:=${timeout})`;
}

/** Register (or update — pg_cron upserts by name) a project's schedule. */
export async function createSchedule(
  project: string,
  spec: ScheduleSpec,
): Promise<Schedule> {
  if (!PROJECT.test(project)) throw new Error(`invalid project name '${project}'`);
  if (!spec?.name || !JOB.test(spec.name)) {
    throw new Error("invalid schedule name (a-z, 0-9, _ , - ; must start with a letter)");
  }
  if (!spec.schedule?.trim()) throw new Error("schedule required (cron expression or interval)");

  const kind: ScheduleKind = spec.kind ?? (spec.url ? "http" : "sql");
  if (kind === "http" && !spec.url) throw new Error("http schedule requires 'url'");
  if (kind === "sql" && !spec.command?.trim()) throw new Error("sql schedule requires 'command'");

  const database = `db_${project}`;
  const jn = jobName(project, spec.name);
  const command = kind === "http" ? httpCommand(spec) : spec.command!.trim();

  const admin = cronAdminClient();
  await admin.connect();
  try {
    await ensureSubstrate(admin, kind === "http");
    // http runs in the cron DB (pg_net worker lives there); sql runs in the
    // tenant DB. pg_cron's schedule*/schedule_in_database upsert by job name.
    const { rows } =
      kind === "http"
        ? await admin.query("select cron.schedule($1, $2, $3) as jobid", [
            jn,
            spec.schedule,
            command,
          ])
        : await admin.query(
            "select cron.schedule_in_database($1, $2, $3, $4) as jobid",
            [jn, spec.schedule, command, database],
          );
    const jobid = rows[0].jobid as number;
    if (spec.active === false) {
      await admin.query("select cron.alter_job($1, active:=false)", [jobid]);
    }
    return {
      project,
      name: spec.name,
      jobid,
      kind,
      schedule: spec.schedule,
      database: kind === "http" ? "postgres" : database,
      active: spec.active !== false,
    };
  } finally {
    await admin.end();
  }
}

/** List a project's schedules (namespaced rows from the shared catalog). */
export async function listSchedules(project: string): Promise<Schedule[]> {
  if (!PROJECT.test(project)) throw new Error(`invalid project name '${project}'`);
  const admin = cronAdminClient();
  await admin.connect();
  try {
    // If pg_cron isn't installed the catalog doesn't exist — treat as empty.
    const has = await admin.query(
      "select 1 from pg_extension where extname = 'pg_cron'",
    );
    if (!has.rowCount) return [];
    const prefix = `${project}__`;
    const { rows } = await admin.query(
      "select jobid, jobname, schedule, database, active, command from cron.job where jobname like $1 order by jobname",
      [prefix + "%"],
    );
    return rows.map((r) => ({
      project,
      name: (r.jobname as string).slice(prefix.length),
      jobid: r.jobid as number,
      kind: kindOf(r.command as string),
      schedule: r.schedule as string,
      database: r.database as string,
      active: r.active as boolean,
    }));
  } finally {
    await admin.end();
  }
}

/** Unschedule a project's job. Idempotent: unknown name ⇒ { removed: false }. */
export async function deleteSchedule(
  project: string,
  name: string,
): Promise<{ project: string; name: string; removed: boolean }> {
  if (!PROJECT.test(project)) throw new Error(`invalid project name '${project}'`);
  if (!JOB.test(name)) throw new Error("invalid schedule name");
  const admin = cronAdminClient();
  await admin.connect();
  try {
    const jn = jobName(project, name);
    const found = await admin.query("select 1 from cron.job where jobname = $1", [jn]);
    if (!found.rowCount) return { project, name, removed: false };
    await admin.query("select cron.unschedule($1)", [jn]);
    return { project, name, removed: true };
  } finally {
    await admin.end();
  }
}
