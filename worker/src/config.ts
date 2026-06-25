import { existsSync } from "node:fs";

// On a host (dev), load a local or repo-root .env; in the container the env is
// injected directly and no file is present, so this is a no-op.
for (const candidate of [".env", "../.env"]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

const list = (v: string | undefined): string[] =>
  (v ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export const config = {
  // The shared pg-boss store — a DIRECT Postgres connection (NOT the pooler;
  // pg-boss needs session-level LISTEN/NOTIFY, which the transaction-mode pooler
  // doesn't carry). Points at the `fleet_worker` role + `hauldr_jobs` database
  // the control plane ensures at bootstrap.
  databaseUrl: process.env.DATABASE_URL ?? "",
  // pg-boss keeps its tables in this schema, isolated from anything else.
  schema: process.env.HAULDR_JOBS_SCHEMA ?? "pgboss",

  // ── brokk-access reconciler ───────────────────────────────────────────────
  // Grant the review bot (brokk-ccl) push on every repo in the org, so a newly
  // created project needs zero manual steps before brokk can open PRs.
  github: {
    token: process.env.GH_ADMIN_TOKEN ?? "",
    org: process.env.GH_ORG ?? "cold-code-labs",
    bot: process.env.GH_BOT ?? "brokk-ccl",
    permission: (process.env.GH_BOT_PERMISSION ?? "push").toLowerCase(),
    // Repos to SKIP (infra you don't want the bot in).
    denylist: list(process.env.GH_BOT_DENYLIST),
    // If set, ONLY these repos (overrides the denylist).
    allowlist: list(process.env.GH_BOT_ALLOWLIST),
    includeArchived: process.env.GH_INCLUDE_ARCHIVED === "1",
    cron: process.env.GH_BOT_CRON ?? "*/15 * * * *",
    // Log what WOULD be granted without writing — safe first run / smoke tests.
    dryRun: process.env.GH_BOT_DRY_RUN === "1",
  },

  // ── kapso-pull-usage reconciler ───────────────────────────────────────────
  // Pull token usage from Kapso workflow executions into kelvin.llm_usage.
  // Source = Kapso platform API; destination = Kelvin's Supabase via PostgREST
  // (schema `kelvin`). Any required value unset → the job skips (no-op), so the
  // worker can ship before this is wired.
  kapso: {
    apiKey: process.env.KAPSO_API_KEY ?? "",
    platform: process.env.KAPSO_PLATFORM_URL ?? "https://api.kapso.ai/platform/v1",
    workflowId:
      process.env.KELVIN_WORKFLOW_ID ?? "88bbca67-283a-4133-9f75-fe2c44cfac1f",
    customerSlug: process.env.KELVIN_CUSTOMER_SLUG ?? "kelvin",
    // Kelvin's Supabase (destination), PostgREST at /rest/v1, schema `kelvin`.
    supabaseUrl:
      process.env.KELVIN_SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    supabaseKey:
      process.env.KELVIN_SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SECRET_KEY ?? "",
    lookbackDays: Number(process.env.KAPSO_LOOKBACK_DAYS ?? 7),
    cron: process.env.KAPSO_CRON ?? "17 3 * * *", // daily ~03:17 UTC
    dryRun: process.env.KAPSO_DRY_RUN === "1",
  },
};
