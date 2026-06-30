/**
 * A fleet job. Each job is a self-contained unit of background work; the worker
 * entrypoint registers it with pg-boss (queue + optional cron + handler).
 *
 * `run` is the actual work — a plain async function, decoupled from pg-boss's
 * handler shape so job logic never depends on the library version. The
 * entrypoint wraps it. Throwing from `run` triggers pg-boss's retry/backoff.
 */
export type FleetJob = {
  /** Unique queue name, e.g. "brokk-access-reconcile". */
  name: string;
  /** Cron expression (UTC) for a scheduled job. Omit for enqueue-only jobs. */
  cron?: string;
  /**
   * The work to perform on each run. Receives the job payload (the `data`
   * passed at enqueue time); cron and parameterless jobs ignore it, so the
   * argument is optional.
   */
  run: (data?: unknown) => Promise<void>;
  /** Max retries on failure (default 3). */
  retryLimit?: number;
  /** Exponential backoff between retries (default true). */
  retryBackoff?: boolean;
};
