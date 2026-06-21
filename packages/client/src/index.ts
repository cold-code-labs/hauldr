import { AuthClient } from "./auth";
import { DbClient } from "./db";
import { S3FilesClient } from "./files";
import { RealtimeClient } from "./live";
import type { HauldrConfig, FilesClient, LiveClient, LiveMessage } from "./types";

export * from "./types";
export { AuthClient } from "./auth";
export { DbClient, UserScopedDb } from "./db";
export { S3FilesClient } from "./files";
export { RealtimeClient } from "./live";

function liveUnconfigured(method: string): never {
  throw new Error(
    `hauldr.live.${method} needs config: createClient({ realtime: { url, accessToken } })`,
  );
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
  on: (): { unsubscribe(): void } => liveUnconfigured("on"),
  onChanges: (): { unsubscribe(): void } => liveUnconfigured("onChanges"),
  presence: () => liveUnconfigured("presence"),
  broadcast: (_topic: string, _event: string, _payload: LiveMessage["payload"]): Promise<void> =>
    liveUnconfigured("broadcast"),
  setAuth: () => liveUnconfigured("setAuth"),
};

export type HauldrClient = {
  auth: AuthClient;
  readonly db: DbClient;
  files: FilesClient;
  live: LiveClient;
};

/**
 * Create a Hauldr client. `auth` works anywhere; `db` is server-only and needs
 * `db.connectionString`. `files` needs `storage`; `live` needs `realtime`.
 * Namespaces left unconfigured throw a clear message pointing at the config.
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
    live: config.realtime ? new RealtimeClient(config.realtime) : liveStub,
  };
}
