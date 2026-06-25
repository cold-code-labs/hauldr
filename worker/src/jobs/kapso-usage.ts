import type { FleetJob } from "./types";
import { config } from "../config";

/**
 * kapso-pull-usage — pull token usage from Kapso workflow executions into
 * kelvin.llm_usage. Walks recent executions (default last 7 days), scans each
 * event payload for token-like fields, and inserts one llm_usage row per
 * execution that produced any tokens.
 *
 * Ported from kelvin/scripts/kapso-pull-usage.mjs, with two changes for life as
 * a scheduled job: it writes via raw PostgREST (no @supabase/supabase-js dep),
 * and it is IDEMPOTENT — it skips executions already recorded, so a daily run
 * with a multi-day lookback (or a pg-boss retry) never double-inserts.
 *
 * Source = Kapso platform API. Destination = Kelvin's Supabase (PostgREST,
 * schema `kelvin`). Any required value unset → the job skips cleanly.
 */

const k = () => config.kapso;

type Usage = {
  prompt: number;
  completion: number;
  model: string | null;
  found: boolean;
};

/** Scan a nested payload for token fields. Pure — exported for the smoke test. */
export function extractUsage(node: unknown, acc: Usage): Usage {
  if (!node || typeof node !== "object") return acc;
  for (const [rawKey, v] of Object.entries(node as Record<string, unknown>)) {
    const key = rawKey.toLowerCase();
    if (typeof v === "number") {
      if (key === "prompt_tokens" || key === "input_tokens") {
        acc.prompt += v;
        acc.found = true;
      } else if (key === "completion_tokens" || key === "output_tokens") {
        acc.completion += v;
        acc.found = true;
      } else if (key === "total_tokens" && acc.prompt + acc.completion === 0) {
        acc.completion += v;
        acc.found = true;
      }
    } else if (typeof v === "string") {
      if (key === "model" && !acc.model) acc.model = v;
    } else if (typeof v === "object") {
      extractUsage(v, acc);
    }
  }
  return acc;
}

async function kapsoApi<T = { data?: unknown[] }>(path: string): Promise<T> {
  const res = await fetch(`${k().platform}${path}`, {
    headers: { "X-API-Key": k().apiKey },
  });
  if (!res.ok) {
    throw new Error(
      `kapso GET ${path} → ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
  return res.json() as Promise<T>;
}

// PostgREST against Kelvin's Supabase. The `kelvin` schema is selected via
// Accept-/Content-Profile (what supabase-js's .schema("kelvin") sends); the
// secret key goes in both apikey and Authorization (service role bypasses RLS).
function pgrstHeaders(write = false): Record<string, string> {
  const key = k().supabaseKey;
  const h: Record<string, string> = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Accept-Profile": "kelvin",
  };
  if (write) {
    h["Content-Profile"] = "kelvin";
    h["Content-Type"] = "application/json";
    h["Prefer"] = "return=minimal";
  }
  return h;
}

async function kelvinCustomerId(): Promise<string | null> {
  const url =
    `${k().supabaseUrl}/rest/v1/customers` +
    `?slug=eq.${encodeURIComponent(k().customerSlug)}&select=id&limit=1`;
  const res = await fetch(url, { headers: pgrstHeaders() });
  if (!res.ok) throw new Error(`kelvin customers lookup → ${res.status}`);
  const rows = (await res.json()) as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

/** Has this execution already been recorded? Idempotency guard. Best-effort: an
 *  unreadable check falls through to insert rather than dropping data. */
async function alreadyRecorded(executionId: string): Promise<boolean> {
  const url =
    `${k().supabaseUrl}/rest/v1/llm_usage` +
    `?source=eq.kapso&metadata->>execution_id=eq.${encodeURIComponent(executionId)}` +
    `&select=id&limit=1`;
  const res = await fetch(url, { headers: pgrstHeaders() });
  if (!res.ok) return false;
  return ((await res.json()) as unknown[]).length > 0;
}

async function insertUsage(row: object): Promise<void> {
  const res = await fetch(`${k().supabaseUrl}/rest/v1/llm_usage`, {
    method: "POST",
    headers: pgrstHeaders(true),
    body: JSON.stringify(row),
  });
  if (!res.ok) {
    throw new Error(
      `llm_usage insert → ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  }
}

async function run(): Promise<void> {
  const c = k();
  if (!c.apiKey || !c.supabaseUrl || !c.supabaseKey) {
    console.log(
      "[kapso-usage] not configured (KAPSO_API_KEY / KELVIN_SUPABASE_URL / KELVIN_SUPABASE_SECRET_KEY) — skipping",
    );
    return;
  }

  const sinceIso = new Date(Date.now() - c.lookbackDays * 86_400_000).toISOString();
  const customerId = await kelvinCustomerId();

  const list = await kapsoApi(
    `/workflows/${c.workflowId}/executions?after=${encodeURIComponent(sinceIso)}&limit=100`,
  );
  const executions = (list.data ?? []) as Array<{
    id: string;
    started_at?: string;
    created_at?: string;
  }>;

  let scanned = 0;
  let withUsage = 0;
  let inserted = 0;
  let existing = 0;
  for (const exec of executions) {
    scanned++;
    const events = await kapsoApi(
      `/workflow_executions/${exec.id}/events?limit=200`,
    );
    const acc: Usage = { prompt: 0, completion: 0, model: null, found: false };
    for (const ev of (events.data ?? []) as Array<{ payload?: unknown }>) {
      extractUsage(ev.payload, acc);
    }
    if (!acc.found) continue;
    withUsage++;

    if (await alreadyRecorded(exec.id)) {
      existing++;
      continue;
    }

    const row = {
      customer_id: customerId,
      source: "kapso",
      model: acc.model ?? "kapso-unknown",
      prompt_tokens: acc.prompt,
      completion_tokens: acc.completion,
      total_tokens: acc.prompt + acc.completion,
      cost_usd_micros: 0,
      metadata: {
        execution_id: exec.id,
        started_at: exec.started_at,
        pulled_at: new Date().toISOString(),
      },
      occurred_at:
        exec.started_at ?? exec.created_at ?? new Date().toISOString(),
    };

    if (c.dryRun) {
      console.log(
        `[kapso-usage] would insert: exec ${exec.id} (${row.total_tokens} tok, ${row.model})`,
      );
      continue;
    }
    await insertUsage(row);
    inserted++;
  }

  console.log(
    `[kapso-usage] kelvin: ${scanned} execs · ${withUsage} with-usage · ` +
      `${inserted} inserted · ${existing} already-recorded` +
      (c.dryRun ? " · DRY-RUN" : "") +
      (withUsage === 0 ? " (kapso exposed no token usage)" : ""),
  );
}

export const kapsoUsage: FleetJob = {
  name: "kapso-pull-usage",
  cron: config.kapso.cron,
  run,
};
