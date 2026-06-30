import PgBoss from "pg-boss";
import { config, jobsUrl } from "./config";

/**
 * The control plane's enqueue-only handle on the shared pg-boss store. The
 * WORKER owns maintenance/cron/scheduling; here we only `send`, so the instance
 * starts with `supervise:false` + `schedule:false` — a lightweight producer.
 *
 * Lazy + memoized: the first enqueue starts pg-boss (and ensures the
 * `app-callback` queue exists, decoupling us from worker boot order); every
 * later call reuses it.
 */
let boss: PgBoss | null = null;
let starting: Promise<PgBoss> | null = null;

async function getBoss(): Promise<PgBoss> {
  if (boss) return boss;
  const url = jobsUrl();
  if (!url) {
    throw new Error(
      "fleet jobs not configured (set HAULDR_JOBS_DB_PASSWORD / HAULDR_JOBS_URL)",
    );
  }
  if (!starting) {
    starting = (async () => {
      const b = new PgBoss({
        connectionString: url,
        schema: config.jobsSchema,
        supervise: false,
        schedule: false,
      });
      b.on("error", (e) => console.error("[jobs] pg-boss error:", e));
      await b.start();
      // Idempotent — safe whether or not the worker has booted yet.
      await b.createQueue("app-callback");
      boss = b;
      return b;
    })();
  }
  return starting;
}

export type EnqueueAppCallback = {
  /** Absolute URL of the app's internal endpoint (host must be allowlisted). */
  url: string;
  /** JSON body the worker POSTs (and signs) to the endpoint. */
  body?: unknown;
  /** Max retries on failure (default 5). */
  retryLimit?: number;
  /** Exponential backoff between retries (default true). */
  retryBackoff?: boolean;
  /**
   * Dedupe key — while a job with this key is queued/active, a second enqueue is
   * a no-op (returns null). Use the caller's event id to make enqueue idempotent.
   */
  singletonKey?: string;
};

/** Enqueue a durable app-callback. Returns the job id, or null if deduped. */
export async function enqueueAppCallback(
  req: EnqueueAppCallback,
): Promise<string | null> {
  const b = await getBoss();
  return b.send(
    "app-callback",
    { url: req.url, body: req.body },
    {
      retryLimit: req.retryLimit ?? 5,
      retryBackoff: req.retryBackoff ?? true,
      ...(req.singletonKey ? { singletonKey: req.singletonKey } : {}),
    },
  );
}
