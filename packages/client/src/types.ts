export type AuthUser = {
  id: string;
  email?: string;
  [k: string]: unknown;
};

export type Session = {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  user: AuthUser;
};

export type HauldrConfig = {
  /** The project endpoint (its GoTrue base URL in pre-alpha). */
  url: string;
  /** Public, RLS-guarded key. Reserved — every request is still subject to RLS. */
  anonKey?: string;
  /** Server-only: connection to the project's pooled Postgres, used by `hauldr.db`. */
  db?: { connectionString: string };
  /** Server-only: the project's S3 bucket + credentials, used by `hauldr.files`. */
  storage?: StorageConfig;
  /** The project's Realtime endpoint, used by `hauldr.live`. */
  realtime?: RealtimeConfig;
};

/** Connection for the project's shared Realtime service (broadcast / presence). */
export type RealtimeConfig = {
  /** Realtime base URL, e.g. https://realtime-<project>.example.com. The client
   *  derives the WebSocket URL (ws/wss) for subscribes and posts to /api/broadcast
   *  for publishes. The host's first label selects the project (Realtime tenant). */
  url: string;
  /** The signed-in user's access token — authorizes the channel + applies RLS.
   *  Server-side publishes may use the project anon/service token instead. */
  accessToken?: string;
};

/** S3 connection for a project's object storage (its own bucket + scoped key). */
export type StorageConfig = {
  /** S3 endpoint, e.g. http://hauldr-garage:3900 */
  endpoint: string;
  /** S3 region label (Garage uses a fixed one; defaults to "garage"). */
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** The project's bucket (one bucket per project). */
  bucket: string;
  /** Path-style addressing — required by Garage and most self-hosted stores (default true). */
  forcePathStyle?: boolean;
};

/** One object to upload. The stored path is `${group}/${key}`. */
export type UploadInput = {
  key: string;
  body: Uint8Array | Buffer | string | ReadableStream | Blob;
  contentType?: string;
};

/**
 * S3-style object storage. The bucket is the project; `group` is a logical prefix
 * within it (e.g. "avatars"). File access control lives as RLS-guarded metadata in
 * the project database — this namespace only moves bytes.
 */
export interface FilesClient {
  upload(group: string, file: UploadInput): Promise<{ path: string }>;
  getSignedUrl(group: string, key: string, opts?: { expiresIn?: number }): Promise<{ url: string }>;
  remove(group: string, key: string): Promise<void>;
}

/** One Realtime broadcast message: a named event with a JSON payload. */
export type LiveMessage = { event: string; payload: unknown };

/**
 * Realtime over the shared, multi-tenant Realtime service (WebSocket).
 *   on(topic, cb)            — subscribe to a topic; cb fires per broadcast event.
 *   broadcast(topic, e, pl)  — publish an event to a topic (e.g. from a server
 *                              action right after a write — the app-driven model).
 * Presence and postgres-changes ride the same socket and land in a later pass.
 */
export interface LiveClient {
  on(topic: string, cb: (message: LiveMessage) => void): { unsubscribe(): void };
  broadcast(topic: string, event: string, payload: unknown): Promise<void>;
}
