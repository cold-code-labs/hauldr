import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { controlPool } from "./db";
import { config } from "./config";
import { coolifyProvisionRest, coolifyDestroyRest } from "./coolify";
import { projectIdentity } from "./gotrue";

const exec = promisify(execFile);

export type ProjectRest = {
  restUrl: string;
  /** docker container name, or coolify app uuid — the provisioner's handle. */
  handle: string;
};

/**
 * What a per-project PostgREST uses to reach its database: the project's
 * AUTHENTICATOR role (a non-owner login role), not postgres. PostgREST SET ROLEs
 * from it to anon / authenticated per request, so RLS is enforced — exactly the
 * Supabase model. Connecting as postgres (the owner) would bypass RLS, so we
 * never do.
 */
function restDbUri(database: string, role: string, password: string): string {
  const u = encodeURIComponent(role);
  const p = encodeURIComponent(password);
  return `postgres://${u}:${p}@${config.authDbHost}:${config.authDbPort}/${database}?sslmode=disable`;
}

/**
 * Gather what PostgREST needs from the registry: the project's database, its
 * authenticator role + password, and the GoTrue JWT secret (so GoTrue-issued
 * tokens validate). REST is layered on an existing project — all three must
 * already be there (created by provisionDatabase + provisionAuth).
 */
async function prepareRest(
  name: string,
): Promise<{ database: string; dbUri: string; jwtSecret: string }> {
  const { rows } = await controlPool.query(
    "select database, role, db_password, jwt_secret from projects where name = $1",
    [name],
  );
  const row = rows[0] as
    | { database: string; role: string; db_password: string | null; jwt_secret: string | null }
    | undefined;
  if (!row) throw new Error(`project '${name}' does not exist`);
  if (!row.db_password) throw new Error(`project '${name}' has no stored db password — re-provision it`);
  if (!row.jwt_secret) {
    throw new Error(
      `project '${name}' has no JWT secret — provision auth (GoTrue) before REST`,
    );
  }
  return {
    database: row.database,
    dbUri: restDbUri(row.database, row.role, row.db_password),
    jwtSecret: row.jwt_secret,
  };
}

/**
 * Provision a project's REST layer: its own PostgREST, connecting as the
 * project's authenticator and validating the project's GoTrue tokens. À-la-carte
 * — called only when an instance opts in (not part of createProject).
 *
 * The provisioner is pluggable (HAULDR_REST_PROVISIONER, defaulting to the auth
 * provisioner): "docker" runs a container directly; "coolify" asks Coolify to
 * run and route it. Idempotent on the app/container.
 */
export async function provisionRest(name: string): Promise<ProjectRest> {
  const { dbUri, jwtSecret } = await prepareRest(name);

  let endpoint: ProjectRest;
  if (config.restProvisioner === "coolify") {
    const { base, env } = await projectIdentity(name);
    endpoint = await coolifyProvisionRest(name, dbUri, jwtSecret, base, env);
  } else {
    endpoint = await dockerProvisionRest(name, dbUri, jwtSecret);
  }

  await controlPool.query(
    "update projects set postgrest_url = $2, postgrest_container = $3 where name = $1",
    [name, endpoint.restUrl, endpoint.handle],
  );
  return endpoint;
}

/** Tear down a project's PostgREST (matches the active provisioner). Idempotent. */
export async function destroyRest(name: string): Promise<void> {
  if (config.restProvisioner === "coolify") {
    const { base, env } = await projectIdentity(name);
    await coolifyDestroyRest(name, base, env).catch(() => {});
  } else {
    await docker(["rm", "-f", `hauldr-rest-${name}`]).catch(() => {});
  }
  await controlPool
    .query(
      "update projects set postgrest_url = null, postgrest_container = null where name = $1",
      [name],
    )
    .catch(() => {});
}

// ── Docker reference provisioner ────────────────────────────────────────────

function dockerParts(): [string, string[]] {
  const parts = config.dockerCmd.split(" ").filter(Boolean);
  return [parts[0], parts.slice(1)];
}
async function docker(args: string[]) {
  const [cmd, pre] = dockerParts();
  return exec(cmd, [...pre, ...args], { maxBuffer: 4 * 1024 * 1024 });
}

async function dockerProvisionRest(
  name: string,
  dbUri: string,
  jwtSecret: string,
): Promise<ProjectRest> {
  const container = `hauldr-rest-${name}`;
  await docker(["rm", "-f", container]).catch(() => {});
  await docker([
    "run", "-d", "--name", container,
    "--network", config.stackNetwork,
    "--restart", "unless-stopped",
    "-p", "127.0.0.1:0:3000",
    "-e", `PGRST_DB_URI=${dbUri}`,
    "-e", "PGRST_DB_SCHEMAS=public",
    "-e", "PGRST_DB_ANON_ROLE=anon",
    "-e", `PGRST_JWT_SECRET=${jwtSecret}`,
    "-e", "PGRST_JWT_AUD=authenticated",
    "-e", "PGRST_DB_USE_LEGACY_GUCS=false",
    "-e", "PGRST_SERVER_PORT=3000",
    config.restImage,
  ]);

  const { stdout } = await docker(["port", container, "3000/tcp"]);
  const hostPort = stdout.trim().split("\n")[0]?.split(":").pop();
  if (!hostPort) throw new Error(`could not resolve PostgREST host port for ${container}`);
  const restUrl = `http://localhost:${hostPort}`;
  await waitForReady(restUrl);
  return { restUrl, handle: container };
}

/** PostgREST serves its OpenAPI spec at `/` (200) once the db is reachable. */
async function waitForReady(baseUrl: string, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(baseUrl);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`PostgREST at ${baseUrl} never became ready`);
}
