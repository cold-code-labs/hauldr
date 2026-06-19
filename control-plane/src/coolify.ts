import { config } from "./config";

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

export type CoolifyEndpoint = { gotrueUrl: string; handle: string };

/** Provision a per-project GoTrue as a Coolify docker-image app. */
export async function coolifyProvisionGotrue(
  name: string,
  dbUrl: string,
  jwtSecret: string,
): Promise<CoolifyEndpoint> {
  if (!config.authDomainPattern) {
    throw new Error("HAULDR_AUTH_DOMAIN_PATTERN is not set (e.g. 'auth-{project}.example.com')");
  }
  const host = config.authDomainPattern.replace("{project}", name);
  const gotrueUrl = `https://${host}`;
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

export async function coolifyDestroyGotrue(name: string): Promise<void> {
  const appUuid = await findAppByName(`hauldr-auth-${name}`);
  if (appUuid) await destroyApp(appUuid);
}
