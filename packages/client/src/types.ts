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
  /**
   * Optional: fetch a fresh access token before the current one expires. Called
   * ~1 minute before expiry (decoded from the JWT), and the new token is pushed to
   * every open channel — so a long-lived private channel keeps its authorization
   * past the access token's lifetime (e.g. a dashboard left open for hours).
   */
  getToken?: () => string | null | undefined | Promise<string | null | undefined>;
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

/** Handle to an open subscription. Call `unsubscribe()` to close the socket. */
export type Subscription = { unsubscribe(): void };

/** Options shared by channel subscribes and broadcasts. */
export type ChannelOptions = {
  /**
   * Private channel. Realtime authorizes the socket against RLS policies on the
   * project's `realtime.messages` table using the access token (role + claims),
   * so only users the policies allow can subscribe or broadcast. Requires an
   * `accessToken` in the realtime config. Public channels (the default) are open
   * to anyone who can reach the service.
   */
  private?: boolean;
};

/** A Postgres change kind, or "*" for all. */
export type PostgresChangeEvent = "INSERT" | "UPDATE" | "DELETE" | "*";

/** What to listen for with `onChanges` (postgres-changes / CDC). */
export type ChangeFilter = {
  /** Change kind — default "*". */
  event?: PostgresChangeEvent;
  /** Schema — default "public". */
  schema?: string;
  /** Table — omit to listen to every table in the schema. */
  table?: string;
  /** Row filter, PostgREST-style, e.g. "owner=eq.<uuid>". */
  filter?: string;
};

/** A delivered Postgres change. RLS-filtered: only rows the user may SELECT. */
export type PostgresChange = {
  type: "INSERT" | "UPDATE" | "DELETE";
  schema: string;
  table: string;
  /** The new row (INSERT / UPDATE). */
  record?: Record<string, unknown>;
  /** The previous row (UPDATE / DELETE — present per the table's REPLICA IDENTITY). */
  old?: Record<string, unknown>;
  /** Commit timestamp (ISO 8601). */
  commitTimestamp?: string;
};

/** Who is on a channel: a map of member key → the state each member published. */
export type PresenceState = Record<string, Array<Record<string, unknown>>>;

/** Options for a presence subscription. */
export type PresenceOptions = ChannelOptions & {
  /** Member key (e.g. a user id) — entries are grouped by it. Default: server-assigned. */
  key?: string;
  /** State to publish on join, so the caller need not call `track` separately. */
  initial?: Record<string, unknown>;
};

/** A live presence subscription. `track` (re)publishes this client's state. */
export type PresenceChannel = {
  /** Publish or replace this client's presence state. */
  track(state: Record<string, unknown>): void;
  /** Stop advertising this client's presence (it leaves the state). */
  untrack(): void;
  unsubscribe(): void;
};

/**
 * Realtime over the shared, multi-tenant Realtime service (WebSocket).
 *   on(topic, cb, opts)         — subscribe to broadcast events on a topic.
 *   onChanges(topic, f, cb)     — subscribe to Postgres row changes (CDC), RLS-filtered.
 *   presence(topic, onSync)     — track who is on a channel (joins / leaves / state).
 *   broadcast(topic, e, pl)     — publish an event (e.g. from a server action right
 *                                 after a write — the app-driven model).
 * Pass `{ private: true }` to gate a channel by RLS on `realtime.messages`.
 */
export interface LiveClient {
  on(topic: string, cb: (message: LiveMessage) => void, opts?: ChannelOptions): Subscription;
  onChanges(
    topic: string,
    filters: ChangeFilter | ChangeFilter[],
    cb: (change: PostgresChange) => void,
    opts?: ChannelOptions,
  ): Subscription;
  presence(topic: string, onSync: (state: PresenceState) => void, opts?: PresenceOptions): PresenceChannel;
  broadcast(topic: string, event: string, payload: unknown, opts?: ChannelOptions): Promise<void>;
  /** Push a fresh access token to every open channel (re-authorizes private ones).
   *  Usually automatic via `getToken`; call this to refresh on your own trigger. */
  setAuth(token: string): void;
}
