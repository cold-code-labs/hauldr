import { controlPool } from "./db";
import { config } from "./config";

/**
 * Storage — per-project object storage on the shared S3 store (Garage). Each
 * project gets its own bucket and a key scoped to it; the control plane talks to
 * the Garage admin API (v2). The bytes live here; the *truth* about who may
 * touch a file is the RLS-guarded `files` table in the project's own database.
 */

export type ProjectStorage = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
};

/** Empty admin URL/token/endpoint = disabled (a deployment without object storage). */
export function storageEnabled(): boolean {
  return Boolean(
    config.garageAdminUrl && config.garageAdminToken && config.garageS3Endpoint,
  );
}

const bucketAlias = (name: string) => `proj-${name}`;

// Garage admin API (v1, REST-style — the version shipped by garage 1.x).
async function garageApi(
  method: string,
  path: string,
  body?: unknown,
): Promise<any> {
  const res = await fetch(`${config.garageAdminUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.garageAdminToken}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    throw new Error(`garage ${method} ${path} failed (${res.status}): ${await res.text()}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

/**
 * Provision a project's bucket + scoped key. Idempotent via the registry: the
 * key secret is only returned once at creation, so it is stored and reused on
 * re-provision (rather than minting a new key each time).
 */
export async function provisionStorage(name: string): Promise<ProjectStorage> {
  const block = (bucket: string, accessKeyId: string, secretAccessKey: string): ProjectStorage => ({
    endpoint: config.garageS3Endpoint,
    region: config.garageRegion,
    bucket,
    accessKeyId,
    secretAccessKey,
  });

  const prev = await controlPool.query(
    "select storage_bucket, storage_access_key_id, storage_secret_key from projects where name = $1",
    [name],
  );
  const p = prev.rows[0];
  if (p?.storage_bucket && p?.storage_access_key_id && p?.storage_secret_key) {
    return block(p.storage_bucket, p.storage_access_key_id, p.storage_secret_key);
  }

  const alias = bucketAlias(name);
  // Create the bucket; if the alias already exists, reuse its id.
  let bucketId: string;
  try {
    bucketId = (await garageApi("POST", "/v1/bucket", { globalAlias: alias })).id;
  } catch (e) {
    const info = await garageApi(
      "GET",
      `/v1/bucket?globalAlias=${encodeURIComponent(alias)}`,
    ).catch(() => null);
    if (!info?.id) throw e;
    bucketId = info.id;
  }

  const key = await garageApi("POST", "/v1/key", { name: `${name}-key` });
  await garageApi("POST", "/v1/bucket/allow", {
    bucketId,
    accessKeyId: key.accessKeyId,
    permissions: { read: true, write: true, owner: false },
  });

  await controlPool.query(
    "update projects set storage_bucket = $2, storage_access_key_id = $3, storage_secret_key = $4 where name = $1",
    [name, alias, key.accessKeyId, key.secretAccessKey],
  );
  return block(alias, key.accessKeyId, key.secretAccessKey);
}

/** Tear down a project's storage (key, then bucket). Idempotent / best-effort. */
export async function destroyStorage(name: string): Promise<void> {
  if (!storageEnabled()) return;
  const prev = await controlPool.query(
    "select storage_bucket, storage_access_key_id from projects where name = $1",
    [name],
  );
  const p = prev.rows[0];
  if (p?.storage_access_key_id) {
    await garageApi(
      "DELETE",
      `/v1/key?id=${encodeURIComponent(p.storage_access_key_id)}`,
    ).catch(() => {});
  }
  if (p?.storage_bucket) {
    const info = await garageApi(
      "GET",
      `/v1/bucket?globalAlias=${encodeURIComponent(p.storage_bucket)}`,
    ).catch(() => null);
    if (info?.id) {
      await garageApi("DELETE", `/v1/bucket?id=${encodeURIComponent(info.id)}`).catch(
        () => {},
      );
    }
  }
}
