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

  // Signing secret for per-project migrate tokens (scoped credentials an app's
  // deploy uses to apply its own schema). Falls back to the management API key,
  // so rotating that rotates the migrate tokens too.
  migrateSecret: process.env.HAULDR_MIGRATE_SECRET ?? "",

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

  // ── Fleet jobs (shared pg-boss worker) ─────────────────────────────────────
  // A single, fleet-wide background-job runner (cron + durable jobs), backed by
  // its OWN database on the shared cluster. Unlike auth/REST it is NOT per
  // project — one worker serves the whole fleet (like Realtime). The control
  // plane owns only the GLUE: at bootstrap it ensures the worker's login role
  // and a dedicated database that role OWNS, so pg-boss can create its own
  // `pgboss` schema and tables on first boot. The `worker` stack service then
  // connects DIRECTLY to Postgres (not the pooler — pg-boss needs session-level
  // LISTEN/NOTIFY, which the transaction-mode pooler doesn't carry). Empty
  // password = jobs disabled: the bootstrap step is skipped.
  jobsDb: process.env.HAULDR_JOBS_DB ?? "hauldr_jobs",
  jobsRole: process.env.HAULDR_JOBS_ROLE ?? "fleet_worker",
  jobsRolePassword: process.env.HAULDR_JOBS_DB_PASSWORD ?? "",
  // pg-boss schema in the jobs store (must match the worker's HAULDR_JOBS_SCHEMA).
  jobsSchema: process.env.HAULDR_JOBS_SCHEMA ?? "pgboss",

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

  // Per-project Storage (supabase/storage-api) — the à-la-carte object-storage
  // API. Opt-in per project, like REST: an instance turns it on when it wants
  // the Supabase `/storage/v1` surface (bucket/object REST) over its Garage
  // bucket, with metadata + RLS in its own database. The bytes layer (bucket +
  // scoped S3 key) is provisioned by storage.ts; this is the API server on top.
  storageApiImage: process.env.HAULDR_STORAGE_API_IMAGE ?? "supabase/storage-api:v1.60.4",
  // Max upload size in bytes (storage-api FILE_SIZE_LIMIT). Default 50 MiB.
  storageFileSizeLimit: Number(process.env.HAULDR_STORAGE_FILE_SIZE_LIMIT ?? 52428800),
  // Legacy host-per-service storage domain; `{project}` substituted. Empty in
  // namespace mode (storage is path-routed at `/storage` under the project host).
  storageDomainPattern: process.env.HAULDR_STORAGE_DOMAIN_PATTERN ?? "",

  // Namespace mode (preferred). One host per logical project — `{project}`
  // substituted with the base identity's host label, e.g.
  // "{project}.hauldr.example.com". Services are path-routed under it (`/auth`,
  // `/rest`) and the dev environment under a `/dev` prefix, so prod and dev of
  // the same identity share one host + one wildcard DNS record + one cert. The
  // orchestrator (Coolify) generates the PathPrefix + stripprefix routing from
  // the path in the app's domain. When empty, the legacy host-per-service mode
  // (authDomainPattern / restDomainPattern) is used instead.
  namespacePattern: process.env.HAULDR_NAMESPACE_PATTERN ?? "",

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

/**
 * Direct connection string to the shared pg-boss store, as the `fleet_worker`
 * role that OWNS it — so enqueueing from the control plane never skews schema
 * ownership (the worker manages the schema as the same role). Built from the
 * admin host/port with the jobs role's creds, or overridden by HAULDR_JOBS_URL.
 * Empty when jobs are disabled (no role password) — callers gate on that.
 */
export function jobsUrl(): string {
  if (process.env.HAULDR_JOBS_URL) return process.env.HAULDR_JOBS_URL;
  if (!config.jobsRolePassword) return "";
  const u = new URL(config.adminUrl);
  u.username = config.jobsRole;
  u.password = config.jobsRolePassword;
  u.pathname = "/" + config.jobsDb;
  return u.toString();
}

/**
 * A project name may contain underscores (valid for Postgres DB/role names, and
 * for Docker container names), but DNS host labels may not (RFC 1123 → only
 * [a-z0-9-]). Sanitize the name to a valid host label for any FQDN derived from
 * it; container and database names keep the underscore.
 */
export function projectHostLabel(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Substitute {project} in a domain pattern with the host-safe label. */
export function hostFromPattern(pattern: string, name: string): string {
  return pattern.replace(/\{project\}/g, projectHostLabel(name));
}

export type ServiceKind = "auth" | "rest" | "realtime" | "storage";

/**
 * The host label for an identity in an environment: `<base>` for prod,
 * `<base>-dev` for dev. The Supabase model — environment is its OWN host (its
 * own "ref"), not a path on a shared host. This is what lets Realtime live on
 * the same host as auth/rest: Realtime resolves its tenant from the host's first
 * label, so each environment needs a distinct label (prod `ufc` vs dev
 * `ufc-dev`) for the shared Realtime service to tell them apart.
 */
export function envHostLabel(base: string, env: string): string {
  const b = projectHostLabel(base);
  return env === "dev" ? `${b}-dev` : b;
}

/**
 * The public endpoint for a project's service, resolved per the active routing
 * mode:
 *
 *   - Namespace mode (HAULDR_NAMESPACE_PATTERN set): one host per environment —
 *     `<base>[-dev].hauldr.<zone>` — with every service path-routed under it
 *     (`/auth`, `/rest`, `/realtime`). `host` is the bare DNS name (covered by
 *     the `*.<namespace>` wildcard record, so no per-project DNS); `domain`
 *     carries the path the proxy turns into PathPrefix + stripprefix. The host's
 *     first label IS the environment's identity, so Realtime derives its tenant
 *     from it. `wildcardDns` true → per-project DNS upsert/delete skipped.
 *
 *   - Legacy mode: one host per service (auth-<project> / rest-<project> /
 *     realtime-<project>), no path. `wildcardDns` false → DNS managed per host.
 */
export function endpointFor(
  base: string,
  env: string,
  service: ServiceKind,
): { host: string; domain: string; wildcardDns: boolean } {
  if (config.namespacePattern) {
    const host = hostFromPattern(config.namespacePattern, envHostLabel(base, env));
    return { host, domain: `${config.endpointScheme}://${host}/${service}`, wildcardDns: true };
  }
  const legacy =
    service === "auth"
      ? config.authDomainPattern
      : service === "rest"
        ? config.restDomainPattern
        : service === "storage"
          ? config.storageDomainPattern
          : config.realtimeDomainPattern;
  if (!legacy) {
    throw new Error(
      `no ${service} endpoint configured (set HAULDR_NAMESPACE_PATTERN or the legacy *_DOMAIN_PATTERN)`,
    );
  }
  // Legacy realtime host already encodes the tenant in its first label, served
  // at the host root (no path); auth/rest likewise sit at the host root.
  const host = hostFromPattern(legacy, base);
  return { host, domain: `${config.endpointScheme}://${host}`, wildcardDns: false };
}

/**
 * The set of domains to register with the orchestrator for a service, ordered
 * native-first. In namespace mode this is the pair `[<host>/<service>,
 * <host>/<service>/v1]`: the native Hauldr path plus a Supabase-dialect alias.
 *
 * supabase-js hardcodes `/auth/v1`, `/rest/v1`, `/realtime/v1`, `/storage/v1`
 * off the base URL, so serving `/<service>/v1` beside `/<service>` lets a
 * migrated supabase-js app plug in by pointing `SUPABASE_URL` at the bare host —
 * no code change. The two route as separate PathPrefix + stripprefix rules;
 * Traefik prefers the longer prefix, so `/auth/v1/token` strips to `/token`
 * (GoTrue) while `/auth/health` strips to `/health`.
 *
 * Legacy host-per-service mode serves the service at the host root with no path,
 * so there is nothing to extend — a single domain, unchanged.
 */
export function routeDomainsFor(base: string, env: string, service: ServiceKind): string[] {
  const ep = endpointFor(base, env, service);
  if (!config.namespacePattern) return [ep.domain];
  return [ep.domain, `${ep.domain}/v1`];
}
