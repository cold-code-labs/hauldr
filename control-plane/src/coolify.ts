import { config, endpointFor, type ServiceKind } from "./config";
import { ensureHostDns, destroyHostDns } from "./dns";

/**
 * Resolve a project's public endpoint for a service and (in legacy host-per-
 * service mode) point its DNS at the edge. In namespace mode the host is covered
 * by the `*.<namespace>` wildcard, so no per-project record is created. Returns
 * the values the caller bakes into the app: `domain` (with the path the
 * orchestrator turns into PathPrefix + stripprefix) and `url` (same string —
 * the public base the service advertises and is probed at).
 */
async function ensureEndpoint(
  base: string,
  env: string,
  service: ServiceKind,
): Promise<{ domain: string; url: string; host: string }> {
  const ep = endpointFor(base, env, service);
  if (!ep.wildcardDns) await ensureHostDns(ep.host);
  return { domain: ep.domain, url: ep.domain, host: ep.host };
}

/**
 * Coolify auth provisioner — brings up a per-project GoTrue as a Coolify
 * docker-image application, reachable at its own domain. This is the production
 * counterpart to the Docker reference provisioner: instead of running a
 * container directly, it asks an orchestrator (Coolify) to run and route it.
 *
 * Nothing platform-specific is hardcoded — the API URL, token, project/server
 * ids, and domain pattern all come from configuration.
 */

type CoolifyInit = { method?: string; body?: unknown };

async function coolify<T = unknown>(path: string, init: CoolifyInit = {}): Promise<T> {
  if (!config.coolifyApiUrl || !config.coolifyToken) {
    throw new Error(
      "Coolify provisioner is not configured (HAULDR_COOLIFY_API_URL / HAULDR_COOLIFY_TOKEN)",
    );
  }
  const res = await fetch(`${config.coolifyApiUrl}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      Authorization: `Bearer ${config.coolifyToken}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Coolify ${path} → ${res.status}: ${text}`);
  return (text ? JSON.parse(text) : {}) as T;
}

function splitImage(ref: string): { name: string; tag: string } {
  const i = ref.lastIndexOf(":");
  return i > 0 ? { name: ref.slice(0, i), tag: ref.slice(i + 1) } : { name: ref, tag: "latest" };
}

export async function findAppByName(name: string): Promise<string | null> {
  const apps = await coolify<Array<{ uuid: string; name: string }>>("/applications");
  return apps.find((a) => a.name === name)?.uuid ?? null;
}

/** Create a docker-image application (idempotent by name). Does not deploy. */
export async function createDockerImageApp(opts: {
  name: string;
  image: string; // name:tag
  portsExposes: string;
  domain: string; // https://host
}): Promise<string> {
  const existing = await findAppByName(opts.name);
  if (existing) return existing;
  const { name: image, tag } = splitImage(opts.image);
  const created = await coolify<{ uuid: string }>("/applications/dockerimage", {
    body: {
      project_uuid: config.coolifyProjectUuid,
      server_uuid: config.coolifyServerUuid,
      ...(config.coolifyDestinationUuid ? { destination_uuid: config.coolifyDestinationUuid } : {}),
      environment_name: config.coolifyEnvironment,
      docker_registry_image_name: image,
      docker_registry_image_tag: tag,
      ports_exposes: opts.portsExposes,
      name: opts.name,
      domains: opts.domain,
      instant_deploy: false,
    },
  });
  // Coolify is eventually-consistent: the create response can return before the
  // app is queryable, so an immediate setEnv/deploy 404s ("Application not
  // found"). Poll until the app is listable, then return that uuid.
  for (let i = 0; i < 12; i++) {
    const found = await findAppByName(opts.name);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return created.uuid;
}

/** Upsert a production env var on an application. */
export async function setEnv(appUuid: string, key: string, value: string): Promise<void> {
  try {
    await coolify(`/applications/${appUuid}/envs`, {
      method: "PATCH",
      body: { key, value, is_preview: false },
    });
  } catch {
    await coolify(`/applications/${appUuid}/envs`, {
      method: "POST",
      body: { key, value, is_preview: false },
    });
  }
}

export async function deployApp(appUuid: string): Promise<void> {
  await coolify(`/deploy?uuid=${appUuid}&force=false`);
}

export async function destroyApp(appUuid: string): Promise<void> {
  await coolify(`/applications/${appUuid}`, { method: "DELETE" });
}

/** Block until an app name is no longer listable. Coolify's DELETE is async, so
 *  a fast delete→re-create would otherwise find the still-deleting app (stale
 *  uuid) and the following setEnv 404s ("Application not found"). Symmetric to
 *  the post-create poll in createDockerImageApp. */
export async function waitAppGone(name: string, tries = 20): Promise<void> {
  for (let i = 0; i < tries; i++) {
    if (!(await findAppByName(name))) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
}

export type CoolifyEndpoint = { gotrueUrl: string; handle: string };

/** Provision a per-project GoTrue as a Coolify docker-image app. `base`/`environment`
 *  resolve the public endpoint: namespace mode path-routes `<base>.hauldr…[/dev]/auth`
 *  (Coolify strips the prefix; GOTRUE_API_EXTERNAL_URL keeps the full external path so
 *  GoTrue's generated links stay correct), legacy mode keeps auth-<project>. */
export async function coolifyProvisionGotrue(
  name: string,
  dbUrl: string,
  jwtSecret: string,
  base: string,
  environment: string,
): Promise<CoolifyEndpoint> {
  const { domain: gotrueUrl } = await ensureEndpoint(base, environment, "auth");
  const appName = `hauldr-auth-${name}`;

  const appUuid = await createDockerImageApp({
    name: appName,
    image: config.gotrueImage,
    portsExposes: "9999",
    domain: gotrueUrl,
  });

  const env: Record<string, string> = {
    GOTRUE_DB_DRIVER: "postgres",
    GOTRUE_DB_DATABASE_URL: dbUrl,
    GOTRUE_DB_NAMESPACE: "auth",
    GOTRUE_JWT_SECRET: jwtSecret,
    GOTRUE_JWT_AUD: "authenticated",
    GOTRUE_JWT_EXP: "3600",
    GOTRUE_JWT_DEFAULT_GROUP_NAME: "authenticated",
    GOTRUE_SITE_URL: gotrueUrl,
    GOTRUE_API_EXTERNAL_URL: gotrueUrl,
    API_EXTERNAL_URL: gotrueUrl,
    GOTRUE_DISABLE_SIGNUP: "false",
    GOTRUE_MAILER_AUTOCONFIRM: "true",
    GOTRUE_API_HOST: "0.0.0.0",
    PORT: "9999",
  };
  // Envs must be set before the deploy that bakes them into the running container.
  for (const [k, v] of Object.entries(env)) await setEnv(appUuid, k, v);
  await deployApp(appUuid);

  return { gotrueUrl, handle: appUuid };
}

export async function coolifyDestroyGotrue(
  name: string,
  base: string,
  environment: string,
): Promise<void> {
  const appName = `hauldr-auth-${name}`;
  const appUuid = await findAppByName(appName);
  if (appUuid) {
    await destroyApp(appUuid);
    await waitAppGone(appName);
  }
  // Per-project DNS only exists in legacy host-per-service mode; in namespace
  // mode the wildcard covers it and prod/dev share the host, so leave DNS alone.
  const ep = endpointFor(base, environment, "auth");
  if (!ep.wildcardDns) await destroyHostDns(ep.host);
}

export type CoolifyRestEndpoint = { restUrl: string; handle: string };

/**
 * Provision a per-project PostgREST as a Coolify docker-image app. PostgREST
 * connects to the project's database AS THE AUTHENTICATOR ROLE (a non-owner
 * login role) and SET ROLEs to anon / authenticated per request — so RLS is
 * enforced. The JWT secret is the project's GoTrue secret, so GoTrue-issued
 * tokens authenticate REST calls, and `request.jwt.claims` (which the base RLS
 * functions read) is populated automatically from the bearer token.
 */
export async function coolifyProvisionRest(
  name: string,
  dbUri: string,
  jwtSecret: string,
  base: string,
  environment: string,
): Promise<CoolifyRestEndpoint> {
  const { domain: restUrl } = await ensureEndpoint(base, environment, "rest");
  const appName = `hauldr-rest-${name}`;

  const appUuid = await createDockerImageApp({
    name: appName,
    image: config.restImage,
    portsExposes: "3000",
    domain: restUrl,
  });

  const env: Record<string, string> = {
    PGRST_DB_URI: dbUri,
    PGRST_DB_SCHEMAS: "public",
    PGRST_DB_ANON_ROLE: "anon",
    PGRST_JWT_SECRET: jwtSecret,
    // Match GoTrue's audience so its tokens validate here.
    PGRST_JWT_AUD: "authenticated",
    // Use the single JSON `request.jwt.claims` GUC (what the base RLS reads),
    // not the legacy per-claim GUCs.
    PGRST_DB_USE_LEGACY_GUCS: "false",
    PGRST_SERVER_PORT: "3000",
    // The public URL, so the served OpenAPI advertises the right base.
    PGRST_OPENAPI_SERVER_PROXY_URI: restUrl,
  };
  for (const [k, v] of Object.entries(env)) await setEnv(appUuid, k, v);
  await deployApp(appUuid);

  return { restUrl, handle: appUuid };
}

export async function coolifyDestroyRest(
  name: string,
  base: string,
  environment: string,
): Promise<void> {
  const appName = `hauldr-rest-${name}`;
  const appUuid = await findAppByName(appName);
  if (appUuid) {
    await destroyApp(appUuid);
    await waitAppGone(appName);
  }
  const ep = endpointFor(base, environment, "rest");
  if (!ep.wildcardDns) await destroyHostDns(ep.host);
}
