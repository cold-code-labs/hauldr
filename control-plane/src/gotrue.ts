import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { adminClient, dbClient, controlPool } from "./db";
import { config } from "./config";
import { coolifyProvisionGotrue, coolifyDestroyGotrue } from "./coolify";

const exec = promisify(execFile);

export type ProjectAuth = {
  gotrueUrl: string;
  jwtSecret: string;
  /** docker container name, or coolify app uuid — the provisioner's handle. */
  handle: string;
};

function ident(s: string) {
  return '"' + s.replace(/"/g, '""') + '"';
}

/** The Postgres URL a per-project GoTrue uses to reach its database (in-network). */
function internalDbUrl(database: string): string {
  const u = new URL(config.adminUrl);
  const user = u.username || "postgres";
  return `postgres://${user}:${u.password}@${config.authDbHost}:${config.authDbPort}/${database}?sslmode=disable`;
}

/** Prepare a project's db for GoTrue (auth schema + search_path) and ensure a stable JWT secret. */
async function prepareAuth(
  name: string,
): Promise<{ database: string; jwtSecret: string; base: string; env: string }> {
  const database = `db_${name}`;
  const prev = await controlPool.query(
    "select jwt_secret, base_name, env from projects where name = $1",
    [name],
  );
  const jwtSecret =
    (prev.rows[0]?.jwt_secret as string | undefined) ??
    crypto.randomBytes(32).toString("hex");
  const base = (prev.rows[0]?.base_name as string | undefined) ?? name;
  const env = (prev.rows[0]?.env as string | undefined) ?? "prod";

  const admin = adminClient();
  await admin.connect();
  try {
    await admin.query(
      `alter database ${ident(database)} set search_path = auth, public`,
    );
  } finally {
    await admin.end();
  }
  const d = dbClient(database);
  await d.connect();
  try {
    await d.query("create schema if not exists auth");
  } finally {
    await d.end();
  }

  await controlPool.query("update projects set jwt_secret = $2 where name = $1", [
    name,
    jwtSecret,
  ]);
  return { database, jwtSecret, base, env };
}

/**
 * Provision a project's auth: its own GoTrue, with its own JWT secret, pointed
 * at the project's database. One GoTrue per project, always.
 *
 * The provisioner is pluggable (HAULDR_AUTH_PROVISIONER):
 *   - "docker"  → run a container directly (self-host / dev),
 *   - "coolify" → ask Coolify to run and route it (production).
 * The database preparation and JWT-secret contract are identical either way.
 */
export async function provisionAuth(name: string): Promise<ProjectAuth> {
  const { database, jwtSecret, base, env } = await prepareAuth(name);
  const dbUrl = internalDbUrl(database);

  const endpoint =
    config.authProvisioner === "coolify"
      ? await coolifyProvisionGotrue(name, dbUrl, jwtSecret, base, env)
      : await dockerProvisionGotrue(name, dbUrl, jwtSecret);

  await controlPool.query(
    "update projects set gotrue_url = $2, gotrue_container = $3 where name = $1",
    [name, endpoint.gotrueUrl, endpoint.handle],
  );
  return { gotrueUrl: endpoint.gotrueUrl, jwtSecret, handle: endpoint.handle };
}

/** Tear down a project's GoTrue (matches the active provisioner). Idempotent. */
export async function destroyAuth(name: string): Promise<void> {
  if (config.authProvisioner === "coolify") {
    const { base, env } = await projectIdentity(name);
    await coolifyDestroyGotrue(name, base, env).catch(() => {});
  } else {
    await docker(["rm", "-f", `hauldr-auth-${name}`]).catch(() => {});
  }
}

/** The logical identity (base) + environment of a project, for endpoint resolution. */
export async function projectIdentity(name: string): Promise<{ base: string; env: string }> {
  const { rows } = await controlPool.query(
    "select base_name, env from projects where name = $1",
    [name],
  );
  return {
    base: (rows[0]?.base_name as string | undefined) ?? name,
    env: (rows[0]?.env as string | undefined) ?? "prod",
  };
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

async function dockerProvisionGotrue(
  name: string,
  dbUrl: string,
  jwtSecret: string,
): Promise<{ gotrueUrl: string; handle: string }> {
  const container = `hauldr-auth-${name}`;
  // Port 0 → Docker assigns a host port; we read it back below.
  await docker(["rm", "-f", container]).catch(() => {});
  await docker([
    "run", "-d", "--name", container,
    "--network", config.stackNetwork,
    "--restart", "unless-stopped",
    "-p", "127.0.0.1:0:9999",
    "-e", "GOTRUE_DB_DRIVER=postgres",
    "-e", `GOTRUE_DB_DATABASE_URL=${dbUrl}`,
    "-e", "GOTRUE_DB_NAMESPACE=auth",
    "-e", `GOTRUE_JWT_SECRET=${jwtSecret}`,
    "-e", "GOTRUE_JWT_AUD=authenticated",
    "-e", "GOTRUE_JWT_EXP=3600",
    "-e", "GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated",
    "-e", "GOTRUE_SITE_URL=http://localhost",
    "-e", "GOTRUE_API_EXTERNAL_URL=http://localhost",
    "-e", "API_EXTERNAL_URL=http://localhost",
    "-e", "GOTRUE_DISABLE_SIGNUP=false",
    "-e", "GOTRUE_MAILER_AUTOCONFIRM=true",
    "-e", "GOTRUE_API_HOST=0.0.0.0",
    "-e", "PORT=9999",
    config.gotrueImage,
  ]);

  const { stdout } = await docker(["port", container, "9999/tcp"]);
  const hostPort = stdout.trim().split("\n")[0]?.split(":").pop();
  if (!hostPort) throw new Error(`could not resolve GoTrue host port for ${container}`);
  const gotrueUrl = `http://localhost:${hostPort}`;
  await waitForHealth(gotrueUrl);
  return { gotrueUrl, handle: container };
}

async function waitForHealth(baseUrl: string, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${baseUrl}/health`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`GoTrue at ${baseUrl} never became healthy`);
}
