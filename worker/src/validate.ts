import { createBoss } from "./boss";
import { brokkAccess } from "./jobs/brokk-access";
import { extractUsage } from "./jobs/kapso-usage";
import { config } from "./config";

/**
 * Worker smoke test (mirrors control-plane's validate-*.ts). Two checks:
 *   1. The job logic runs directly (no DB needed). Read-only against GitHub when
 *      GH_BOT_DRY_RUN=1 — set that to test without granting anything.
 *   2. The pg-boss layer: start (creates the schema) + createQueue + send/work
 *      roundtrip against a real Postgres. Skipped if DATABASE_URL is unset.
 * Exits non-zero on any failure.
 */

const timeout = (ms: number): Promise<never> =>
  new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms).unref(),
  );

async function main(): Promise<void> {
  // 1) Job logic, no pg-boss.
  console.log(`[validate] brokk-access.run() (dryRun=${config.github.dryRun})…`);
  await brokkAccess.run();
  console.log("[validate] ✓ brokk-access ran");

  // 1b) kapso-usage token-extraction heuristic — pure, no network.
  const u = extractUsage(
    { data: { usage: { prompt_tokens: 10, completion_tokens: 5 }, model: "gpt-4o" } },
    { prompt: 0, completion: 0, model: null, found: false },
  );
  if (!(u.found && u.prompt === 10 && u.completion === 5 && u.model === "gpt-4o")) {
    throw new Error(`extractUsage heuristic broken: ${JSON.stringify(u)}`);
  }
  console.log("[validate] ✓ kapso extractUsage heuristic");

  // 2) pg-boss roundtrip — only with a store configured.
  if (!config.databaseUrl) {
    console.log("[validate] no DATABASE_URL — skipping pg-boss roundtrip");
    process.exit(0);
  }
  const boss = createBoss();
  boss.on("error", (e) => console.error("[validate] boss error:", e));
  await boss.start();
  console.log("[validate] ✓ pg-boss started (schema ok)");

  await boss.createQueue(brokkAccess.name);
  let fired = false;
  const delivered = new Promise<void>((resolve) => {
    void boss.work(brokkAccess.name, async () => {
      fired = true;
      resolve();
    });
  });
  await boss.send(brokkAccess.name, {});
  await Promise.race([delivered, timeout(20000)]);
  await boss.stop({ graceful: true });

  if (!fired) throw new Error("pg-boss never delivered the job to the handler");
  console.log("[validate] ✓ pg-boss send/work roundtrip");
  console.log("[validate] OK");
  process.exit(0);
}

main().catch((e) => {
  console.error("[validate] FAILED:", e);
  process.exit(1);
});
