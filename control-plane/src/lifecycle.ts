import { controlPool } from "./db";
import { config } from "./config";
import { provisionDatabase } from "./provision";
import { provisionAuth } from "./gotrue";
import { provisionRest } from "./postgrest";
import { storageEnabled, provisionStorage } from "./storage";
import { defaultOrgId } from "./orgs";
import { signMigrateToken } from "./migrate-auth";

const SLUG = /^[a-z][a-z0-9_]{1,40}$/;

export type ProvisionOpts = {
  rest?: boolean;
  organizationId?: string;
  /** Environment of this project (prod | dev). Defaults to dev for a `<base>_dev`
   *  name, else prod. */
  env?: "prod" | "dev";
  /** Logical identity prod and dev share — the public host is `<base>.hauldr…`.
   *  Defaults to the name with a trailing `_dev` stripped. */
  baseName?: string;
};

/** Derive the (base, env) identity from explicit opts, falling back to the
 *  `<base>_dev` naming convention. */
function identityFrom(name: string, opts: ProvisionOpts): { base: string; env: "prod" | "dev" } {
  const isDev = opts.env === "dev" || (!opts.env && /_dev$/.test(name));
  const base = opts.baseName ?? (isDev ? name.replace(/_dev$/, "") : name);
  return { base, env: isDev ? "dev" : "prod" };
}

/**
 * The internal DB URL for an app that runs on the SAME server (shared Docker
 * network): a direct connection to `hauldr-db` as the project's authenticator.
 * This is the security win — the database is reached over the internal network
 * and never needs a public route. RLS is still enforced (the SDK SET ROLEs to
 * `authenticated` and injects the JWT claims per transaction).
 */
function internalDbUrl(database: string, role: string, password: string): string {
  const u = encodeURIComponent(role);
  const p = encodeURIComponent(password);
  return `postgres://${u}:${p}@${config.authDbHost}:${config.authDbPort}/${database}?sslmode=disable`;
}

/**
 * Register a project as 'provisioning' and do the real work in the background,
 * so the API returns immediately and the panel can poll the status while the
 * sidecars come up. GoTrue is always provisioned (unless authProvisioner=none);
 * PostgREST when opts.rest. Status flips to 'live' only once the sidecars are
 * actually healthy — not merely when their deploys were queued.
 */
export async function startProvision(
  name: string,
  opts: ProvisionOpts = {},
): Promise<{ name: string; status: string }> {
  if (!SLUG.test(name)) {
    throw new Error(
      `invalid project name '${name}' (a-z, 0-9, _, must start with a letter)`,
    );
  }
  const database = `db_${name}`;
  const role = `${name}_authenticator`;
  const organizationId = opts.organizationId ?? (await defaultOrgId());
  const { base, env } = identityFrom(name, opts);
  await controlPool.query(
    `insert into projects (name, database, role, status, rest_requested, organization_id, base_name, env)
       values ($1, $2, $3, 'provisioning', $4, $5, $6, $7)
     on conflict (name) do update
       set status = 'provisioning', status_detail = null,
           rest_requested = excluded.rest_requested,
           organization_id = coalesce(projects.organization_id, excluded.organization_id),
           base_name = coalesce(projects.base_name, excluded.base_name),
           env = coalesce(projects.env, excluded.env)`,
    [name, database, role, !!opts.rest, organizationId, base, env],
  );
  void provisionInBackground(name, opts);
  return { name, status: "provisioning" };
}

async function provisionInBackground(name: string, opts: ProvisionOpts): Promise<void> {
  try {
    await provisionDatabase(name);
    const auth = config.authProvisioner === "none" ? null : await provisionAuth(name);
    const rest = opts.rest ? await provisionRest(name) : null;
    if (storageEnabled()) await provisionStorage(name);
    // Wait for the sidecars to actually answer before declaring the project live.
    // A sidecar can flap to exited:unhealthy on its FIRST deploy (it may start
    // before the DB grants settle); waitStableHealing re-provisions once if so.
    if (auth) await waitStableHealing(`${auth.gotrueUrl}/health`, () => provisionAuth(name));
    if (rest) await waitStableHealing(`${rest.restUrl}/`, () => provisionRest(name));
    await controlPool.query(
      "update projects set status = 'live', status_detail = null where name = $1",
      [name],
    );
    console.log(`project ${name}: live`);
  } catch (e) {
    const msg = (e as Error).message;
    await controlPool
      .query("update projects set status = 'error', status_detail = $2 where name = $1", [name, msg])
      .catch(() => {});
    console.error(`project ${name}: provisioning failed: ${msg}`);
  }
}

/** A freshly-deployed sidecar flaps through the edge for a few seconds; require
 *  a short streak of healthy probes before trusting it. */
async function waitStable(url: string, need = 2, tries = 150): Promise<void> {
  let streak = 0;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      streak = r.ok ? streak + 1 : 0;
      if (streak >= need) return;
    } catch {
      streak = 0;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  throw new Error(`endpoint ${url} never became stable`);
}

/** waitStable, but self-healing: a freshly-provisioned Coolify sidecar
 *  occasionally comes up `exited:unhealthy` on its FIRST deploy (it can start
 *  before the project's DB grants/roles settle). If the first window fails,
 *  re-provision once (idempotent → re-deploys the same app) and wait again
 *  before giving up — this automates the manual redeploy that used to be needed. */
async function waitStableHealing(
  url: string,
  reprovision: () => Promise<unknown>,
): Promise<void> {
  try {
    await waitStable(url, 2, 60); // ~2.5 min first window
    return;
  } catch {
    console.warn(`sidecar ${url} not stable on first deploy — re-provisioning once`);
  }
  await reprovision();
  await waitStable(url, 2, 96); // ~4 min after the redeploy
}

/**
 * Full project detail: persisted state + a live health probe of each sidecar +
 * the internal connection block (for same-server apps). This is what the panel
 * polls and what a provisioner reads to wire an app to its backend.
 */
export async function getProjectDetail(name: string) {
  const { rows } = await controlPool.query(
    `select name, database, role, db_password, jwt_secret, status, status_detail,
            gotrue_url, postgrest_url, rest_requested, created_at,
            storage_bucket, storage_access_key_id, storage_secret_key,
            realtime_url, realtime_external_id
       from projects where name = $1`,
    [name],
  );
  const r = rows[0];
  if (!r) return null;

  const [authReady, restReady, realtimeReady] = await Promise.all([
    r.gotrue_url ? probe(`${r.gotrue_url}/health`) : Promise.resolve(false),
    r.postgrest_url ? probe(`${r.postgrest_url}/`) : Promise.resolve(false),
    r.realtime_external_id && config.realtimeUrl
      ? probe(`${config.realtimeUrl}/api/tenants/${r.realtime_external_id}/health`)
      : Promise.resolve(false),
  ]);

  // Self-heal a stale status: provisioning can persist 'error' (e.g. a sidecar
  // flapped on its first deploy) even though every expected sidecar now answers.
  // The live probes are the source of truth — if all expected ones are ready,
  // reconcile the persisted status to 'live'. One-directional (never flips a
  // live project to error on a transient probe miss).
  let status = r.status;
  let statusDetail = r.status_detail;
  const restExpected = !!r.rest_requested;
  const realtimeExpected = !!r.realtime_url;
  const allReady =
    authReady &&
    (!restExpected || restReady) &&
    (!realtimeExpected || realtimeReady);
  if (status !== "live" && allReady) {
    await controlPool
      .query("update projects set status = 'live', status_detail = null where name = $1", [r.name])
      .catch(() => {});
    status = "live";
    statusDetail = null;
  }

  return {
    name: r.name,
    database: r.database,
    role: r.role,
    status,
    statusDetail,
    createdAt: r.created_at,
    services: {
      auth: r.gotrue_url ? { url: r.gotrue_url, ready: authReady } : null,
      rest: r.postgrest_url
        ? { url: r.postgrest_url, ready: restReady }
        : r.rest_requested
          ? { url: null, ready: false }
          : null,
      realtime: r.realtime_url
        ? { url: r.realtime_url, externalId: r.realtime_external_id, ready: realtimeReady }
        : null,
    },
    // Internal connection for an app on the shared network — DB never goes public.
    // jwtSecret is the project's GoTrue signing secret — a provisioner needs it
    // to verify the app's auth tokens. Sits with the rest of the wiring material.
    internal: r.db_password
      ? {
          dbHost: config.authDbHost,
          dbPort: config.authDbPort,
          database: r.database,
          role: r.role,
          dbUrl: internalDbUrl(r.database, r.role, r.db_password),
          jwtSecret: r.jwt_secret ?? null,
          // Scoped credential an app's deploy uses to apply its own schema
          // (POST /v1/projects/<name>/migrate) without the global management key.
          migrateToken: signMigrateToken(r.name),
        }
      : null,
    // S3 storage block an app feeds to createClient({ storage }) — one bucket/key
    // per project. Endpoint is in-network (the store never needs a public route).
    storage: r.storage_bucket
      ? {
          endpoint: config.garageS3Endpoint,
          region: config.garageRegion,
          bucket: r.storage_bucket,
          accessKeyId: r.storage_access_key_id,
          secretAccessKey: r.storage_secret_key,
        }
      : null,
  };
}

async function probe(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return res.ok;
  } catch {
    return false;
  }
}
