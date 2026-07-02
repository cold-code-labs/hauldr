import pg from "pg";
import { config, urlForDb } from "./config";

const { Client, Pool } = pg;

/** Admin connection to the default `postgres` db — for CREATE DATABASE / ROLE. */
export function adminClient() {
  return new Client({ connectionString: config.adminUrl });
}

/** Admin connection to the Cron plane cluster's `postgres` db (pg_cron/pg_net).
 *  Same as adminClient() unless HAULDR_CRON_ADMIN_URL points cron at a separate
 *  (v17) cluster during the substrate transition. */
export function cronAdminClient() {
  return new Client({ connectionString: config.cronAdminUrl });
}

/** Admin connection pointed at a specific database. */
export function dbClient(database: string) {
  return new Client({ connectionString: urlForDb(database) });
}

/** Pool to the control db (`hauldr`). Lazy — only connects on first query. */
export const controlPool = new Pool({
  connectionString: urlForDb(config.controlDb),
});
