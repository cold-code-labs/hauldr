import { createBoss } from "./boss";
import { jobs } from "./jobs";

/**
 * Fleet jobs worker — boots the shared pg-boss instance, registers every job
 * (queue + optional cron schedule + handler), and runs until stopped. One
 * worker serves the whole fleet.
 */
async function main(): Promise<void> {
  const boss = createBoss();
  boss.on("error", (e) => console.error("[worker] pg-boss error:", e));

  await boss.start();
  console.log("[worker] pg-boss started");

  for (const job of jobs) {
    await boss.createQueue(job.name);

    if (job.cron) {
      // Idempotent: re-asserts the schedule on every boot (upsert by name).
      await boss.schedule(
        job.name,
        job.cron,
        {},
        {
          tz: "UTC",
          retryLimit: job.retryLimit ?? 3,
          retryBackoff: job.retryBackoff ?? true,
        },
      );
      console.log(`[worker] scheduled ${job.name} (${job.cron} UTC)`);
    }

    await boss.work(job.name, async () => {
      const t0 = Date.now();
      console.log(`[job:${job.name}] start`);
      try {
        await job.run();
        console.log(`[job:${job.name}] done in ${Date.now() - t0}ms`);
      } catch (e) {
        console.error(`[job:${job.name}] failed:`, (e as Error).message);
        throw e; // let pg-boss apply the retry/backoff policy
      }
    });
    console.log(`[worker] working ${job.name}`);
  }

  const stop = async (sig: string): Promise<void> => {
    console.log(`[worker] ${sig} — stopping`);
    try {
      await boss.stop({ graceful: true });
    } finally {
      process.exit(0);
    }
  };
  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}

main().catch((e) => {
  console.error("[worker] fatal:", e);
  process.exit(1);
});
