import { AuthClient } from "./auth";
import { DbClient } from "./db";
import type { HauldrConfig, FilesClient, LiveClient } from "./types";

export * from "./types";
export { AuthClient } from "./auth";
export { DbClient, UserScopedDb } from "./db";

function pending(method: string): never {
  throw new Error(`hauldr.${method} is not implemented yet (pre-alpha) — see the roadmap`);
}

const filesStub: FilesClient = {
  upload: () => pending("files.upload"),
  getSignedUrl: () => pending("files.getSignedUrl"),
  remove: () => pending("files.remove"),
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
    files: filesStub,
    live: liveStub,
  };
}
