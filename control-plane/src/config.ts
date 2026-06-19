import { existsSync } from "node:fs";

// Load a repo-root .env when running on a host (dev / CLI). In containers the
// environment is injected directly and no file is present, so this is a no-op.
for (const candidate of ["../.env", ".env"]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

export const config = {
  adminUrl:
    process.env.HAULDR_DB_ADMIN_URL ??
    "postgres://postgres:postgres@localhost:5433/postgres",
  controlDb: process.env.HAULDR_CONTROL_DB ?? "hauldr",
  apiPort: Number(process.env.HAULDR_API_PORT ?? 8787),

  // Bearer key guarding the /v1 management API. When set, every /v1 request
  // must carry `Authorization: Bearer <key>`. Empty = open (dev only).
  apiKey: process.env.HAULDR_API_KEY ?? "",

  // Auth — project zero (GoTrue) + panel JWT verification.
  jwtSecret: process.env.HAULDR_JWT_SECRET ?? "",
  zeroDb: process.env.HAULDR_ZERO_DB ?? "hauldr_zero",
  gotrueUrl: process.env.HAULDR_GOTRUE_URL ?? "http://localhost:9999",
  masterEmail: process.env.HAULDR_MASTER_EMAIL ?? "admin@example.com",
  masterPassword: process.env.HAULDR_MASTER_PASSWORD ?? "",

  // Supavisor pooler. Empty apiUrl/secret = disabled (direct connection).
  poolerApiUrl: process.env.HAULDR_POOLER_API_URL ?? "",
  poolerApiSecret: process.env.SUPAVISOR_API_JWT_SECRET ?? "",
  poolerMetaDb: process.env.SUPAVISOR_META_DB ?? "_supabase",
  poolerUpstreamHost: process.env.HAULDR_POOLER_UPSTREAM_HOST ?? "db",
  poolerUpstreamPort: Number(process.env.HAULDR_POOLER_UPSTREAM_PORT ?? 5432),
  poolerHost: process.env.HAULDR_POOLER_HOST ?? "localhost",
  poolerPort: Number(process.env.HAULDR_POOLER_PORT ?? 6543),
  // Session-mode port — a dedicated upstream connection per client, for the
  // rare client that needs session-level features (vs. the transaction-mode
  // data port, which is what RLS-bound data uses).
  poolerSessionPort: Number(process.env.HAULDR_POOLER_SESSION_PORT ?? 5432),

  // Per-project auth provisioning. "docker" brings up a GoTrue container per
  // project (the reference / self-host path); "none" skips it (data plane only).
  authProvisioner: process.env.HAULDR_AUTH_PROVISIONER ?? "docker",
  // How to invoke Docker for the reference auth provisioner. Set to e.g.
  // "sudo docker" where the control plane's user is not in the docker group.
  dockerCmd: process.env.HAULDR_DOCKER_CMD ?? "docker",
  // The Docker network the shared stack runs on; per-project GoTrue containers
  // join it to reach `db`. Defaults to the compose project network.
  stackNetwork: process.env.HAULDR_STACK_NETWORK ?? "hauldr_default",
};

/** Returns the admin connection string pointed at a specific database. */
export function urlForDb(database: string): string {
  const u = new URL(config.adminUrl);
  u.pathname = "/" + database;
  return u.toString();
}
