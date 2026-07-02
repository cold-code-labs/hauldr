import crypto from "node:crypto";
import { controlPool, dbClient } from "./db";
import { config, hostFromPattern, endpointFor } from "./config";
import { ensureHostDns, destroyHostDns } from "./dns";

// Shared Realtime: register / deregister a project as a TENANT of the one shared
// Realtime service (broadcast / presence / postgres-changes over WebSocket).
//
// Realtime is multi-tenant by design — a single service holds a `tenants` table
// (each with its own JWT secret + db connection) and routes a connection to the
// right tenant by the host's first label. So "provisioning" a project's realtime
// is not a new container (as PostgREST is) but a row in that table, created via
// the service's management API. The tenant's jwt_secret IS the project's GoTrue
// secret, so the same token that signs into GoTrue authorizes a realtime channel.

export type ProjectRealtime = {
  /** Public per-project Realtime host the SDK connects to. */
  realtimeUrl: string;
  /** Tenant id Realtime resolves from the host's first label. */
  externalId: string;
};

export function realtimeEnabled(): boolean {
  return !!config.realtimeUrl;
}

/** A project's (base, env) identity, for endpoint + tenant resolution. */
async function identityOf(name: string): Promise<{ base: string; env: string }> {
  const { rows } = await controlPool.query(
    "select base_name, env from projects where name = $1",
    [name],
  );
  return {
    base: (rows[0]?.base_name as string | undefined) ?? name,
    env: (rows[0]?.env as string | undefined) ?? "prod",
  };
}

/**
 * The project's Realtime endpoint. Namespace mode: `<base>[-dev].hauldr.<zone>/realtime`
 * (same host as auth/rest) — the SDK appends `/socket/websocket`, the proxy strips
 * `/realtime` and PRESERVES the Host, so the shared Realtime service resolves the
 * tenant from the host's first label. Legacy mode: the dedicated `realtime-<proj>`
 * host at the root. `externalId` (the tenant id) is always that first label.
 */
function realtimeEndpoint(base: string, env: string): { url: string; externalId: string; host: string } {
  if (config.namespacePattern) {
    const ep = endpointFor(base, env, "realtime");
    return { url: ep.domain, externalId: ep.host.split(".")[0], host: ep.host };
  }
  if (config.realtimeDomainPattern) {
    const host = hostFromPattern(config.realtimeDomainPattern, base);
    return { url: `${config.endpointScheme}://${host}`, externalId: host.split(".")[0], host };
  }
  return { url: config.realtimeUrl, externalId: `realtime-${base}`, host: "" };
}

// RLS for private channels. Realtime's per-tenant migrations create
// `realtime.messages` with RLS enabled and NO policies — so every private channel
// is denied until policies exist. This opens private channels to any authenticated
// user (a valid project JWT), which is strictly stronger than a public channel
// (open to anyone who reaches the service). Apps tighten this per topic by
// replacing these policies, e.g. `using (realtime.topic() = 'room:' || ...)`.
// Idempotent (drop-then-create); applied after the tenant is registered, because
// the table only exists once the per-tenant migrations have run.
const REALTIME_RLS_SQL = `
  grant usage on schema realtime to authenticated;
  grant select, insert on realtime.messages to authenticated;

  drop policy if exists hauldr_authenticated_read on realtime.messages;
  create policy hauldr_authenticated_read on realtime.messages
    for select to authenticated using (true);

  drop policy if exists hauldr_authenticated_write on realtime.messages;
  create policy hauldr_authenticated_write on realtime.messages
    for insert to authenticated with check (true);
`;

/** Grant authenticated users access to private channels (RLS on realtime.messages). */
async function applyRealtimeRls(database: string): Promise<void> {
  const target = dbClient(database);
  await target.connect();
  try {
    await target.query(REALTIME_RLS_SQL);
  } finally {
    await target.end();
  }
}

/** A short-lived admin JWT for the Realtime management API (API_JWT_SECRET). */
function adminToken(): string {
  if (!config.jwtSecret) throw new Error("HAULDR_JWT_SECRET is not set");
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ role: "supabase_admin", iat: now, exp: now + 300 }),
  ).toString("base64url");
  const data = `${header}.${payload}`;
  const sig = crypto.createHmac("sha256", config.jwtSecret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

/**
 * Provision a project's realtime: ensure the project DB can host Realtime's
 * per-tenant schema, then upsert the tenant via the shared service's API. The
 * service runs its per-tenant migrations into the project DB on first register.
 * Idempotent — re-registering updates the tenant in place.
 */
export async function provisionRealtime(name: string): Promise<ProjectRealtime> {
  if (!realtimeEnabled()) {
    throw new Error("realtime is not configured (set HAULDR_REALTIME_URL)");
  }

  const { rows } = await controlPool.query(
    "select database, jwt_secret from projects where name = $1",
    [name],
  );
  const row = rows[0] as { database: string; jwt_secret: string | null } | undefined;
  if (!row) throw new Error(`project '${name}' does not exist`);
  if (!row.jwt_secret) {
    throw new Error(`project '${name}' has no JWT secret — provision auth before realtime`);
  }

  // Realtime's per-tenant migrations connect with search_path=realtime and can't
  // create the schema, so it must already exist (the base schema adds it; ensure
  // it here too for projects provisioned before realtime support landed).
  const target = dbClient(row.database);
  await target.connect();
  try {
    await target.query("create schema if not exists realtime authorization postgres");
  } finally {
    await target.end();
  }

  const { base, env } = await identityOf(name);
  const endpoint = realtimeEndpoint(base, env);
  const externalId = endpoint.externalId;
  const admin = new URL(config.adminUrl);
  const body = {
    tenant: {
      name: externalId,
      external_id: externalId,
      jwt_secret: row.jwt_secret,
      max_concurrent_users: 200,
      max_events_per_second: 100,
      postgres_cdc_default: "postgres_cdc_rls",
      extensions: [
        {
          type: "postgres_cdc_rls",
          // Realtime encrypts these (string-typed) fields, so db_port must be a
          // string. CDC connects as the admin/superuser to read the WAL + manage
          // the replication slot (postgres-changes; needs wal_level=logical).
          settings: {
            db_host: config.authDbHost,
            db_port: String(config.authDbPort),
            db_name: row.database,
            db_user: decodeURIComponent(admin.username),
            db_password: decodeURIComponent(admin.password),
            region: config.garageRegion || "local",
            poll_interval_ms: 100,
            poll_max_record_bytes: 1048576,
            ssl_enforced: false,
          },
        },
      ],
    },
  };

  const res = await fetch(`${config.realtimeUrl}/api/tenants`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${adminToken()}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`realtime tenant register failed (${res.status}): ${txt.slice(0, 200)}`);
  }

  // Registering the tenant ran Realtime's per-tenant migrations, so
  // `realtime.messages` now exists — add the RLS policies that make private
  // channels usable by authenticated users.
  await applyRealtimeRls(row.database);

  // Point the project's public Realtime host at the edge. In namespace mode the
  // host is covered by the `*.hauldr` wildcard (endpoint.host's record already
  // resolves) so this is skipped; in legacy mode it upserts the dedicated host.
  // Best-effort: the tenant is already registered and usable in-network, so a DNS
  // hiccup must not fail the opt-in. The edge router is one shared rule (Host
  // `*.hauldr` && PathPrefix `/realtime` → strip → shared service, Host kept).
  if (endpoint.host && !config.namespacePattern) {
    try {
      await ensureHostDns(endpoint.host);
    } catch (e) {
      console.warn(`realtime: DNS for ${endpoint.host} not set (${(e as Error).message}) — point it manually`);
    }
  }

  const realtimeUrl = endpoint.url;
  await controlPool.query(
    "update projects set realtime_url = $2, realtime_external_id = $3 where name = $1",
    [name, realtimeUrl, externalId],
  );
  return { realtimeUrl, externalId };
}

/** Deregister a project's Realtime tenant + drop its public host DNS. Idempotent. */
export async function destroyRealtime(name: string): Promise<void> {
  const { base, env } = await identityOf(name);
  const endpoint = realtimeEndpoint(base, env);
  if (realtimeEnabled()) {
    await fetch(`${config.realtimeUrl}/api/tenants/${endpoint.externalId}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${adminToken()}` },
    }).catch(() => {});
  }
  if (endpoint.host && !config.namespacePattern) await destroyHostDns(endpoint.host).catch(() => {});
  await controlPool
    .query(
      "update projects set realtime_url = null, realtime_external_id = null where name = $1",
      [name],
    )
    .catch(() => {});
}
