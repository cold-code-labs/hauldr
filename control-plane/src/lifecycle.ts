import { controlPool } from "./db";
import { config } from "./config";
import { provisionDatabase } from "./provision";
import { provisionAuth } from "./gotrue";
import { provisionRest } from "./postgrest";

const SLUG = /^[a-z][a-z0-9_]{1,40}$/;

export type ProvisionOpts = { rest?: boolean };

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
  await controlPool.query(
    `insert into projects (name, database, role, status, rest_requested)
       values ($1, $2, $3, 'provisioning', $4)
     on conflict (name) do update
       set status = 'provisioning', status_detail = null,
           rest_requested = excluded.rest_requested`,
    [name, database, role, !!opts.rest],
  );
  void provisionInBackground(name, opts);
  return { name, status: "provisioning" };
}

async function provisionInBackground(name: string, opts: ProvisionOpts): Promise<void> {
  try {
    await provisionDatabase(name);
    const auth = config.authProvisioner === "none" ? null : await provisionAuth(name);
    const rest = opts.rest ? await provisionRest(name) : null;
    // Wait for the sidecars to actually answer before declaring the project live.
    if (auth) await waitStable(`${auth.gotrueUrl}/health`);
    if (rest) await waitStable(`${rest.restUrl}/`);
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

/**
 * Full project detail: persisted state + a live health probe of each sidecar +
 * the internal connection block (for same-server apps). This is what the panel
 * polls and what a provisioner reads to wire an app to its backend.
 */
export async function getProjectDetail(name: string) {
  const { rows } = await controlPool.query(
    `select name, database, role, db_password, status, status_detail,
            gotrue_url, postgrest_url, rest_requested, created_at
       from projects where name = $1`,
    [name],
  );
  const r = rows[0];
  if (!r) return null;

  const [authReady, restReady] = await Promise.all([
    r.gotrue_url ? probe(`${r.gotrue_url}/health`) : Promise.resolve(false),
    r.postgrest_url ? probe(`${r.postgrest_url}/`) : Promise.resolve(false),
  ]);

  return {
    name: r.name,
    database: r.database,
    role: r.role,
    status: r.status,
    statusDetail: r.status_detail,
    createdAt: r.created_at,
    services: {
      auth: r.gotrue_url ? { url: r.gotrue_url, ready: authReady } : null,
      rest: r.postgrest_url
        ? { url: r.postgrest_url, ready: restReady }
        : r.rest_requested
          ? { url: null, ready: false }
          : null,
    },
    // Internal connection for an app on the shared network — DB never goes public.
    internal: r.db_password
      ? {
          dbHost: config.authDbHost,
          dbPort: config.authDbPort,
          database: r.database,
          role: r.role,
          dbUrl: internalDbUrl(r.database, r.role, r.db_password),
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
