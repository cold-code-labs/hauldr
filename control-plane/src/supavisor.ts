import crypto from "node:crypto";
import { config } from "./config";

/**
 * Supavisor — multi-tenant pooler. Each project is a tenant; clients route to
 * its database by encoding the tenant in the username (`db_user.external_id`).
 * Tenants are registered through Supavisor's management API.
 */

export function poolerEnabled(): boolean {
  return Boolean(config.poolerApiUrl && config.poolerApiSecret);
}

/** A short-lived HS256 JWT for the Supavisor management API. */
function apiToken(): string {
  const b64 = (s: string) => Buffer.from(s).toString("base64url");
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64(
    JSON.stringify({ iss: "hauldr", role: "service_role", exp: now + 300 }),
  );
  const sig = crypto
    .createHmac("sha256", config.poolerApiSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${sig}`;
}

export type TenantUser = {
  dbUser: string;
  dbPassword: string;
  /** transaction = RLS-bound data; session = a session-consistent connection. */
  mode: "transaction" | "session";
};

/**
 * Register (or update) a tenant routing `externalId` → `database`. Each user is
 * a distinct upstream login with its own pool mode — the authenticator for
 * RLS-bound data runs in transaction mode. Idempotent (PUT).
 */
export async function registerTenant(opts: {
  externalId: string;
  database: string;
  users: TenantUser[];
}): Promise<void> {
  const res = await fetch(
    `${config.poolerApiUrl}/api/tenants/${encodeURIComponent(opts.externalId)}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiToken()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tenant: {
          db_host: config.poolerUpstreamHost,
          db_port: config.poolerUpstreamPort,
          db_database: opts.database,
          ip_version: "auto",
          enforce_ssl: false,
          require_user: true,
          users: opts.users.map((u) => ({
            db_user: u.dbUser,
            db_password: u.dbPassword,
            pool_size: 5,
            mode_type: u.mode,
            is_manager: false,
          })),
        },
      }),
    },
  );
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(
      `Supavisor registerTenant failed (${res.status}): ${await res.text()}`,
    );
  }
}

/**
 * Deregister a tenant — drops its pooler routes and releases the upstream
 * connections, so nothing blocks a subsequent DROP DATABASE. Idempotent: a
 * missing tenant (404) is treated as already-gone.
 */
export async function deregisterTenant(externalId: string): Promise<void> {
  const res = await fetch(
    `${config.poolerApiUrl}/api/tenants/${encodeURIComponent(externalId)}`,
    { method: "DELETE", headers: { Authorization: `Bearer ${apiToken()}` } },
  );
  if (res.status !== 200 && res.status !== 204 && res.status !== 404) {
    throw new Error(
      `Supavisor deregisterTenant failed (${res.status}): ${await res.text()}`,
    );
  }
}

/**
 * The pooler-backed connection string a client/SDK uses to reach the project.
 * `session` selects the session-mode port (for the auth framework); otherwise
 * the transaction-mode port (for RLS-bound data).
 */
export function poolerConnectionString(opts: {
  externalId: string;
  database: string;
  dbUser: string;
  dbPassword: string;
  session?: boolean;
}): string {
  const user = encodeURIComponent(`${opts.dbUser}.${opts.externalId}`);
  const pw = encodeURIComponent(opts.dbPassword);
  const port = opts.session ? config.poolerSessionPort : config.poolerPort;
  return `postgres://${user}:${pw}@${config.poolerHost}:${port}/${opts.database}`;
}
