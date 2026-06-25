import PgBoss from "pg-boss";
import { config } from "./config";

/**
 * The shared pg-boss instance. One store, one schema, for the whole fleet.
 * `start()` (called by the worker entrypoint) creates the `pgboss` schema and
 * tables on first boot — which works because the `fleet_worker` role OWNS its
 * database (set up by the control plane's bootstrap).
 */
export function createBoss(): PgBoss {
  if (!config.databaseUrl) {
    throw new Error("DATABASE_URL is required (the pg-boss store)");
  }
  return new PgBoss({
    connectionString: config.databaseUrl,
    schema: config.schema,
  });
}
