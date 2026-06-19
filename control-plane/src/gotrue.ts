import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { adminClient, dbClient, controlPool } from "./db";
import { config } from "./config";

const exec = promisify(execFile);

const GOTRUE_IMAGE = process.env.HAULDR_GOTRUE_IMAGE ?? "supabase/gotrue:v2.190.0";

export type ProjectAuth = {
  gotrueUrl: string;
  jwtSecret: string;
  container: string;
};

function dockerParts(): [string, string[]] {
  const parts = config.dockerCmd.split(" ").filter(Boolean);
  return [parts[0], parts.slice(1)];
}
async function docker(args: string[]) {
  const [cmd, pre] = dockerParts();
  return exec(cmd, [...pre, ...args], { maxBuffer: 4 * 1024 * 1024 });
}

function ident(s: string) {
  return '"' + s.replace(/"/g, '""') + '"';
}

/** The in-network Postgres URL a per-project GoTrue uses to reach its database. */
function internalDbUrl(database: string): string {
  const u = new URL(config.adminUrl);
  const user = u.username || "postgres";
  return `postgres://${user}:${u.password}@${config.poolerUpstreamHost}:${config.poolerUpstreamPort}/${database}?sslmode=disable`;
}

/**
 * Provision a project's auth: its own GoTrue, with its own JWT secret, pointed
 * at the project's database (`auth` schema). One GoTrue per project, always —
 * the canonical Hauldr auth model. Idempotent: re-running replaces the
 * container and reuses the stored secret.
 *
 * This is the Docker reference implementation (self-hosting / dev). A platform
 * that runs services through an orchestrator (Coolify, Nomad, k8s) swaps the
 * container step for an API call — the database preparation and the JWT-secret
 * contract are identical.
 */
export async function provisionAuth(name: string): Promise<ProjectAuth> {
  const database = `db_${name}`;
  const container = `hauldr-auth-${name}`;

  const prev = await controlPool.query(
    "select jwt_secret from projects where name = $1",
    [name],
  );
  const jwtSecret =
    (prev.rows[0]?.jwt_secret as string | undefined) ??
    crypto.randomBytes(32).toString("hex");

  // Prepare the project db for GoTrue: an `auth` schema it owns, plus a
  // search_path so its migrations and runtime resolve there. App data lives in
  // public/hauldr and is untouched.
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

  await controlPool.query(
    "update projects set jwt_secret = $2, gotrue_container = $3 where name = $1",
    [name, jwtSecret, container],
  );

  // (Re)create the GoTrue container on the stack network so it can reach `db`.
  // Port 0 → let Docker assign a host port; we read it back below.
  await docker(["rm", "-f", container]).catch(() => {});
  await docker([
    "run", "-d", "--name", container,
    "--network", config.stackNetwork,
    "--restart", "unless-stopped",
    "-p", "127.0.0.1:0:9999",
    "-e", "GOTRUE_DB_DRIVER=postgres",
    "-e", `GOTRUE_DB_DATABASE_URL=${internalDbUrl(database)}`,
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
    GOTRUE_IMAGE,
  ]);

  const { stdout } = await docker(["port", container, "9999/tcp"]);
  const hostPort = stdout.trim().split("\n")[0]?.split(":").pop();
  if (!hostPort) throw new Error(`could not resolve GoTrue host port for ${container}`);
  const gotrueUrl = `http://localhost:${hostPort}`;

  await controlPool.query(
    "update projects set gotrue_url = $2 where name = $1",
    [name, gotrueUrl],
  );

  await waitForHealth(gotrueUrl);
  return { gotrueUrl, jwtSecret, container };
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

/** Tear down a project's GoTrue. Idempotent (a missing container is fine). */
export async function destroyAuth(name: string): Promise<void> {
  const container = `hauldr-auth-${name}`;
  await docker(["rm", "-f", container]).catch(() => {});
}
