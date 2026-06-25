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
};
