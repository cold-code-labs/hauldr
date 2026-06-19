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
};

/** S3-style object storage (pre-alpha — not yet implemented). */
export interface FilesClient {
  upload(bucket: string, file: unknown): Promise<{ path: string }>;
  getSignedUrl(bucket: string, path: string, opts?: { expiresIn?: number }): Promise<{ url: string }>;
  remove(bucket: string, path: string): Promise<void>;
}

/** Realtime over SSE (pre-alpha — not yet implemented). */
export interface LiveClient {
  on(channel: string, cb: (change: unknown) => void): { unsubscribe(): void };
}
