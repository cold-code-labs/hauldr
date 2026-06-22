import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { controlPool } from "./db";
import { config, projectHostLabel } from "./config";
import { coolifyProvisionStorageApi, coolifyDestroyStorageApi } from "./coolify";
import { projectIdentity } from "./gotrue";
import { provisionStorage } from "./storage";
import { mintApiKey } from "./keys";

const exec = promisify(execFile);

export type ProjectStorageApi = {
  storageUrl: string;
  /** docker container name, or coolify app uuid — the provisioner's handle. */
  handle: string;
};

/** The Postgres URL storage-api uses to reach its database: the project's owner
 *  (postgres) — it installs the `storage` schema + roles and runs metadata
 *  queries, so it needs DDL. Per-request authorization still keys off the JWT.
 *  Mirrors GoTrue's internal admin connection. */
function adminDbUrl(database: string): string {
  const u = new URL(config.adminUrl);
  const user = u.username || "postgres";
  return `postgres://${user}:${u.password}@${config.authDbHost}:${config.authDbPort}/${database}?sslmode=disable`;
}

/**
 * Assemble what a per-project storage-api needs: its database (as the owner, for
 * the storage schema + metadata), the GoTrue JWT secret (so GoTrue tokens
 * validate) plus anon/service_role keys minted from it, and the project's Garage
 * bucket + scoped S3 key (the bytes backend). Ensures the bucket + key exist
 * first (provisionStorage is idempotent) — storage is layered on an existing
 * project, so the db + auth must already be there.
 */
async function prepareStorageApi(name: string): Promise<Record<string, string>> {
  const store = await provisionStorage(name);
  const { rows } = await controlPool.query(
    "select database, jwt_secret from projects where name = $1",
    [name],
  );
  const row = rows[0] as { database: string; jwt_secret: string | null } | undefined;
  if (!row) throw new Error(`project '${name}' does not exist`);
  if (!row.jwt_secret) {
    throw new Error(`project '${name}' has no JWT secret — provision auth before storage`);
  }
  const secret = row.jwt_secret;

  return {
    SERVER_PORT: "5000",
    // Validate GoTrue-issued tokens with the project's secret (same as PostgREST).
    AUTH_JWT_SECRET: secret,
    AUTH_JWT_ALGORITHM: "HS256",
    // Supabase-shaped keys, minted from the secret (the `apikey` header + admin).
    ANON_KEY: mintApiKey("anon", secret),
    SERVICE_KEY: mintApiKey("service_role", secret),
    // Metadata + schema live in the project DB; storage-api installs its schema
    // and the storage roles on boot (idempotent against the existing base roles).
    DATABASE_URL: adminDbUrl(row.database),
    DB_INSTALL_ROLES: "true",
    // Bytes go to the project's Garage bucket via the S3 backend (path-style —
    // Garage requires it). The key is scoped to just this project's bucket.
    STORAGE_BACKEND: "s3",
    STORAGE_S3_BUCKET: store.bucket,
    GLOBAL_S3_BUCKET: store.bucket,
    STORAGE_S3_ENDPOINT: store.endpoint,
    STORAGE_S3_FORCE_PATH_STYLE: "true",
    STORAGE_S3_REGION: store.region,
    REGION: store.region,
    AWS_ACCESS_KEY_ID: store.accessKeyId,
    AWS_SECRET_ACCESS_KEY: store.secretAccessKey,
    AWS_DEFAULT_REGION: store.region,
    TENANT_ID: projectHostLabel(name),
    FILE_SIZE_LIMIT: String(config.storageFileSizeLimit),
    // No imgproxy in the stack — keep image transformation off so boot doesn't
    // depend on a service we don't run.
    ENABLE_IMAGE_TRANSFORMATION: "false",
  };
}

/**
 * Provision a project's Storage layer: its own supabase/storage-api, serving the
 * `/storage/v1` surface over the project's Garage bucket with metadata + RLS in
 * the project database. À-la-carte — called only when an instance opts in (not
 * part of createProject). Pluggable provisioner (HAULDR_STORAGE_PROVISIONER,
 * defaulting to the auth provisioner): "docker" or "coolify".
 */
export async function provisionStorageApi(name: string): Promise<ProjectStorageApi> {
  if (!storageBackendReady()) {
    throw new Error(
      "storage is not configured (set HAULDR_GARAGE_* so a bucket + key can be provisioned)",
    );
  }
  const env = await prepareStorageApi(name);

  let endpoint: ProjectStorageApi;
  if (storageProvisioner() === "coolify") {
    const { base, env: environment } = await projectIdentity(name);
    endpoint = await coolifyProvisionStorageApi(name, env, base, environment);
  } else {
    endpoint = await dockerProvisionStorageApi(name, env);
  }

  await controlPool.query(
    "update projects set storage_api_url = $2, storage_api_container = $3 where name = $1",
    [name, endpoint.storageUrl, endpoint.handle],
  );
  return endpoint;
}

/** Tear down a project's storage-api (matches the active provisioner). The
 *  bucket + key are left to destroyStorage. Idempotent. */
export async function destroyStorageApi(name: string): Promise<void> {
  if (storageProvisioner() === "coolify") {
    const { base, env } = await projectIdentity(name);
    await coolifyDestroyStorageApi(name, base, env).catch(() => {});
  } else {
    await docker(["rm", "-f", `hauldr-storage-${name}`]).catch(() => {});
  }
  await controlPool
    .query(
      "update projects set storage_api_url = null, storage_api_container = null where name = $1",
      [name],
    )
    .catch(() => {});
}

function storageProvisioner(): string {
  return process.env.HAULDR_STORAGE_PROVISIONER ?? config.restProvisioner;
}

/** Storage-api needs the Garage bytes backend configured (storage.ts gates on
 *  the same envs). */
function storageBackendReady(): boolean {
  return Boolean(config.garageS3Endpoint);
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

async function dockerProvisionStorageApi(
  name: string,
  env: Record<string, string>,
): Promise<ProjectStorageApi> {
  const container = `hauldr-storage-${name}`;
  await docker(["rm", "-f", container]).catch(() => {});
  const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  await docker([
    "run", "-d", "--name", container,
    "--network", config.stackNetwork,
    "--restart", "unless-stopped",
    "-p", "127.0.0.1:0:5000",
    ...envArgs,
    config.storageApiImage,
  ]);

  const { stdout } = await docker(["port", container, "5000/tcp"]);
  const hostPort = stdout.trim().split("\n")[0]?.split(":").pop();
  if (!hostPort) throw new Error(`could not resolve storage-api host port for ${container}`);
  const storageUrl = `http://localhost:${hostPort}`;
  await waitForReady(storageUrl);
  return { storageUrl, handle: container };
}

/** storage-api answers /status with 200 once the db is reachable + migrated. */
async function waitForReady(baseUrl: string, tries = 60): Promise<void> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${baseUrl}/status`);
      if (r.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`storage-api at ${baseUrl} never became ready`);
}
