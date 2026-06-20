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
  // Name of the default organization (tenant zero) for an unattended install —
  // when env master creds are present, the bootstrap creates it automatically.
  // A fresh install with no env master is set up through the first-run wizard.
  defaultOrgName: process.env.HAULDR_ORG_NAME ?? "My Organization",

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

  // Object storage (Garage). Empty adminUrl/token/s3Endpoint = disabled (a
  // deployment without object storage; `hauldr.files` stays unconfigured). The
  // control plane reaches the admin API in-network; apps reach S3 via the S3
  // endpoint handed to them in the project detail.
  garageAdminUrl: process.env.HAULDR_GARAGE_ADMIN_URL ?? "",
  garageAdminToken: process.env.GARAGE_ADMIN_TOKEN ?? "",
  garageS3Endpoint: process.env.HAULDR_GARAGE_S3_ENDPOINT ?? "",
  garageRegion: process.env.HAULDR_GARAGE_REGION ?? "garage",

  // Per-project auth provisioning. "docker" brings up a GoTrue container per
  // project (the reference / self-host path); "none" skips it (data plane only).
  authProvisioner: process.env.HAULDR_AUTH_PROVISIONER ?? "docker",
  // How to invoke Docker for the reference auth provisioner. Set to e.g.
  // "sudo docker" where the control plane's user is not in the docker group.
  dockerCmd: process.env.HAULDR_DOCKER_CMD ?? "docker",
  // The Docker network the shared stack runs on; per-project GoTrue containers
  // join it to reach `db`. Defaults to the compose project network.
  stackNetwork: process.env.HAULDR_STACK_NETWORK ?? "hauldr_default",

  // Coolify auth provisioner (authProvisioner = "coolify"). Every value comes
  // from the environment — nothing platform-specific is baked into the code.
  coolifyApiUrl: process.env.HAULDR_COOLIFY_API_URL ?? "",
  coolifyToken: process.env.HAULDR_COOLIFY_TOKEN ?? "",
  coolifyProjectUuid: process.env.HAULDR_COOLIFY_PROJECT_UUID ?? "",
  coolifyServerUuid: process.env.HAULDR_COOLIFY_SERVER_UUID ?? "",
  coolifyDestinationUuid: process.env.HAULDR_COOLIFY_DESTINATION_UUID ?? "",
  coolifyEnvironment: process.env.HAULDR_COOLIFY_ENVIRONMENT ?? "production",
  // Per-project auth endpoint domain; `{project}` is substituted — e.g.
  // "auth-{project}.example.com". Routed by your reverse proxy / tunnel.
  authDomainPattern: process.env.HAULDR_AUTH_DOMAIN_PATTERN ?? "",
  // URL scheme for per-project endpoints (auth, REST). "https" (default) asks the
  // orchestrator to obtain a TLS cert. Behind a proxy that terminates TLS at the
  // edge (e.g. a Cloudflare tunnel), set "http": the origin attempts no cert —
  // which avoids the orchestrator hanging on ACME for a domain it can't validate
  // directly — and the edge still serves HTTPS to clients. HAULDR_AUTH_SCHEME is
  // honoured as a back-compat alias.
  endpointScheme:
    process.env.HAULDR_ENDPOINT_SCHEME ?? process.env.HAULDR_AUTH_SCHEME ?? "https",
  // GoTrue image (name:tag), used by both the docker and coolify provisioners.
  gotrueImage: process.env.HAULDR_GOTRUE_IMAGE ?? "supabase/gotrue:v2.190.0",
  // Where a per-project GoTrue reaches its database. Defaults to the in-network
  // `db` (the docker provisioner joins that network). In a split deploy — e.g.
  // GoTrue as separate Coolify apps — point this at the shared Postgres's
  // address on the shared network.
  authDbHost:
    process.env.HAULDR_AUTH_DB_HOST ?? process.env.HAULDR_POOLER_UPSTREAM_HOST ?? "db",
  authDbPort: Number(
    process.env.HAULDR_AUTH_DB_PORT ?? process.env.HAULDR_POOLER_UPSTREAM_PORT ?? 5432,
  ),

  // Per-project REST (PostgREST) — the à-la-carte data API. Opt-in per project:
  // only an instance that wants a raw REST surface over its data turns it on.
  // The backend (docker / coolify) defaults to whatever auth uses, so a stack
  // already wired for Coolify auth gets Coolify REST with no extra config.
  restProvisioner:
    process.env.HAULDR_REST_PROVISIONER ?? process.env.HAULDR_AUTH_PROVISIONER ?? "docker",
  // PostgREST image (name:tag). Pinned to a known-good release; PostgREST keeps
  // old tags published, so a fixed pin is safe.
  restImage: process.env.HAULDR_REST_IMAGE ?? "postgrest/postgrest:v12.2.3",
  // Per-project REST endpoint domain; `{project}` is substituted — e.g.
  // "rest-{project}.example.com". Routed by your reverse proxy / tunnel. Kept
  // distinct from the auth pattern so the two endpoints never collide.
  restDomainPattern: process.env.HAULDR_REST_DOMAIN_PATTERN ?? "",

  // Realtime — the SHARED, multi-tenant Realtime service (broadcast / presence /
  // postgres-changes over WebSocket). Unlike auth/REST it is NOT per-project: one
  // service serves every project, each registered as a Realtime "tenant" via its
  // management API. Opt-in per project (services/realtime). Empty url = disabled.
  //   realtimeUrl     — in-network management/WS endpoint, e.g. http://realtime:4000
  //   realtimeDomainPattern — public per-project host; `{project}` substituted
  //     (e.g. "realtime-{project}.example.com"). Realtime derives the tenant from
  //     the host's first label, so the tenant external_id IS that whole label.
  realtimeUrl: process.env.HAULDR_REALTIME_URL ?? "",
  realtimeDomainPattern: process.env.HAULDR_REALTIME_DOMAIN_PATTERN ?? "",

  // Per-project auth DNS. The Coolify provisioner routes a project's GoTrue at an
  // external host (HAULDR_AUTH_DOMAIN_PATTERN); that host resolves only once a DNS
  // record points it at the edge in front of this server.
  //   - "none"       → the operator manages DNS out of band (e.g. one wildcard
  //                    record covering every auth host). The default — the public
  //                    build needs no DNS credentials.
  //   - "cloudflare" → upsert / remove a CNAME via the Cloudflare API. The token,
  //                    zone, and target are all configuration; nothing about a
  //                    specific domain or account is baked into the code.
  dnsProvisioner: process.env.HAULDR_DNS_PROVISIONER ?? "none",
  cloudflareDnsToken: process.env.CLOUDFLARE_DNS_TOKEN ?? "",
  cloudflareZoneId: process.env.CLOUDFLARE_ZONE_ID ?? "",
  // What an auth host points at — e.g. a tunnel hostname "<id>.cfargotunnel.com",
  // or any edge / load-balancer hostname that fronts this server.
  dnsTarget: process.env.HAULDR_DNS_TARGET ?? "",
  // Whether the record runs through the CDN/proxy (Cloudflare's "orange cloud").
  dnsProxied: (process.env.HAULDR_DNS_PROXIED ?? "true") !== "false",
};

/** Returns the admin connection string pointed at a specific database. */
export function urlForDb(database: string): string {
  const u = new URL(config.adminUrl);
  u.pathname = "/" + database;
  return u.toString();
}
