import { AuthClient } from "./auth";
import { DbClient } from "./db";
import { S3FilesClient } from "./files";
import type { HauldrConfig, FilesClient, LiveClient } from "./types";

export * from "./types";
export { AuthClient } from "./auth";
export { DbClient, UserScopedDb } from "./db";
export { S3FilesClient } from "./files";

function pending(method: string): never {
  throw new Error(`hauldr.${method} is not implemented yet (pre-alpha) — see the roadmap`);
}

function filesUnconfigured(method: string): never {
  throw new Error(
    `hauldr.files.${method} needs server-side config: createClient({ storage: { endpoint, bucket, accessKeyId, secretAccessKey } })`,
  );
}

const filesStub: FilesClient = {
  upload: () => filesUnconfigured("upload"),
  getSignedUrl: () => filesUnconfigured("getSignedUrl"),
  remove: () => filesUnconfigured("remove"),
};

const liveStub: LiveClient = {
  on: () => pending("live.on"),
};

export type HauldrClient = {
  auth: AuthClient;
  readonly db: DbClient;
  files: FilesClient;
  live: LiveClient;
};

/**
 * Create a Hauldr client. `auth` works anywhere; `db` is server-only and needs
 * `db.connectionString`. `files` and `live` are part of the surface but land in
 * a later milestone (they throw a clear not-implemented for now).
 */
export function createClient(config: HauldrConfig): HauldrClient {
  const auth = new AuthClient(config.url);
  const db = config.db ? new DbClient(config.db.connectionString) : null;
  return {
    auth,
    get db(): DbClient {
      if (!db) {
        throw new Error(
          "hauldr.db needs server-side config: createClient({ db: { connectionString } })",
        );
      }
      return db;
    },
    files: config.storage ? new S3FilesClient(config.storage) : filesStub,
    live: liveStub,
  };
}
