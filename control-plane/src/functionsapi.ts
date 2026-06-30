import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { randomBytes } from "node:crypto";
import { controlPool } from "./db";
import { config, projectHostLabel, endpointFor } from "./config";
import { mintApiKey } from "./keys";

const exec = promisify(execFile);

export type ProjectFunctions = {
  functionsUrl: string;
  /** docker container name — the provisioner's handle. */
  handle: string;
};

/**
 * The Functions Plane: a per-project `supabase/edge-runtime` (Deno) serving the
 * project's edge functions at `/functions/v1`. Unlike storage-api/PostgREST, the
 * edge-runtime is NOT a self-contained image — it needs the function source
 * mounted plus a custom start command — so this uses the docker provisioner
 * (volume + command + Traefik labels), mirroring the as-built proven on Viken.
 *
 * The function source lives on the docker host at `${functionsDir}/<name>` and
 * MUST contain a `main/` router (standard self-host `EdgeRuntime.userWorkers`)
 * plus one dir per function. `hauldr migrate-in` populates it (pulling the
 * DEPLOYED source from the origin Supabase via the Management API eszip endpoint
 * — the repo is not the source of truth). App-specific secrets (Vindi/Resend/…)
 * are layered by migrate-in; the base env below boots the runtime and runs the
 * DB-backed functions (service_role against the project).
 */

/** Public base URL of the project (namespace mode: `<label>.hauldr.<zone>`). */
function projectBaseUrl(name: string): string {
  const { host } = endpointFor(name, "prod", "functions");
  return `${config.endpointScheme}://${host}`;
}

/** Env the edge-runtime needs: the project's public URL + anon/service_role
 *  keys minted from its JWT secret, plus a cron secret (the X-Cron-Secret the
 *  systemd timers present; service_role bearer also authorizes cron calls). */
async function prepareFunctions(name: string): Promise<Record<string, string>> {
  const { rows } = await controlPool.query(
    "select jwt_secret from projects where name = $1",
    [name],
  );
  const row = rows[0] as { jwt_secret: string | null } | undefined;
  if (!row) throw new Error(`project '${name}' does not exist`);
  if (!row.jwt_secret) {
    throw new Error(`project '${name}' has no JWT secret — provision auth before functions`);
  }
  const secret = row.jwt_secret;
  const baseUrl = projectBaseUrl(name);

  return {
    // supabase-js inside functions plugs in via the project's public host.
    SUPABASE_URL: baseUrl,
    APP_BASE_URL: baseUrl,
    SUPABASE_ANON_KEY: mintApiKey("anon", secret),
    SUPABASE_SERVICE_ROLE_KEY: mintApiKey("service_role", secret),
    // Shared secret for cron-triggered functions (X-Cron-Secret header). The
    // systemd timers read it back from the running container's env, so it must
    // be stable across the container's life — generated once per provision.
    CRON_SECRET: randomBytes(24).toString("hex"),
  };
}

/**
 * Provision a project's Functions Plane. À-la-carte (opt-in), like rest/storage.
 * Docker provisioner only — see the note above on why Coolify's docker-image app
 * can't mount the function source or set the start command.
 */
export async function provisionFunctions(name: string): Promise<ProjectFunctions> {
  const env = await prepareFunctions(name);
  const endpoint = await dockerProvisionFunctions(name, env);
  await controlPool.query(
    "update projects set functions_url = $2, functions_container = $3 where name = $1",
    [name, endpoint.functionsUrl, endpoint.handle],
  );
  return endpoint;
}

/** Tear down a project's Functions Plane. Idempotent. */
export async function destroyFunctions(name: string): Promise<void> {
  await docker(["rm", "-f", `hauldr-functions-${name}`]).catch(() => {});
  await controlPool
    .query(
      "update projects set functions_url = null, functions_container = null where name = $1",
      [name],
    )
    .catch(() => {});
}

// ── Docker provisioner ──────────────────────────────────────────────────────

function dockerParts(): [string, string[]] {
  const parts = config.dockerCmd.split(" ").filter(Boolean);
  return [parts[0], parts.slice(1)];
}
async function docker(args: string[]) {
  const [cmd, pre] = dockerParts();
  return exec(cmd, [...pre, ...args], { maxBuffer: 4 * 1024 * 1024 });
}

async function dockerProvisionFunctions(
  name: string,
  env: Record<string, string>,
): Promise<ProjectFunctions> {
  const container = `hauldr-functions-${name}`;
  const handleSlug = `hf-${projectHostLabel(name)}`; // Traefik router/service id
  const { host } = endpointFor(name, "prod", "functions");
  const sourceDir = `${config.functionsDir}/${name}`;

  await docker(["rm", "-f", container]).catch(() => {});
  const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);

  // Gateway route: <host>/functions/v1/* → :9000, stripping the prefix so the
  // edge-runtime's main router sees `/<slug>` (matches `functions.invoke()`).
  const labels = [
    "--label", "traefik.enable=true",
    "--label", `traefik.http.routers.${handleSlug}.rule=Host(\`${host}\`) && PathPrefix(\`/functions/v1\`)`,
    "--label", `traefik.http.routers.${handleSlug}.middlewares=${handleSlug}-strip`,
    "--label", `traefik.http.middlewares.${handleSlug}-strip.stripprefix.prefixes=/functions/v1`,
    "--label", `traefik.http.services.${handleSlug}.loadbalancer.server.port=9000`,
  ];

  await docker([
    "run", "-d", "--name", container,
    "--network", config.stackNetwork,
    "--restart", "unless-stopped",
    "-v", `${sourceDir}:/home/deno/functions:ro`,
    ...envArgs,
    ...labels,
    config.edgeRuntimeImage,
    "start", "--main-service", "/home/deno/functions/main", "-p", "9000",
  ]);

  const functionsUrl = `${projectBaseUrl(name)}/functions`;
  return { functionsUrl, handle: container };
}
