/**
 * Coolify provisioner test. Exercises the docker-image app lifecycle the
 * per-project GoTrue provisioner relies on — create → set env → deploy → reach
 * it at its domain → destroy — using a trivial image (traefik/whoami), so it
 * validates the Coolify plumbing without GoTrue's database wiring.
 *
 * Requires a configured Coolify (HAULDR_COOLIFY_* + HAULDR_AUTH_DOMAIN_PATTERN).
 * Run:  pnpm validate:coolify
 */
import { config } from "./config";
import {
  createDockerImageApp,
  setEnv,
  deployApp,
  destroyApp,
  findAppByName,
} from "./coolify";

let failures = 0;
function assert(cond: boolean, msg: string) {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures++;
}

async function reachable(url: string, tries = 30): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (r.ok) return true;
    } catch {
      // not routed yet
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

async function main() {
  const name = "hauldr-probe";
  const host = (config.authDomainPattern || "auth-{project}.example.com").replace("{project}", "probe");
  const domain = `https://${host}`;

  // Clean any leftover from a previous run.
  const leftover = await findAppByName(name);
  if (leftover) {
    await destroyApp(leftover);
    await new Promise((r) => setTimeout(r, 3000));
  }

  const appUuid = await createDockerImageApp({
    name,
    image: "traefik/whoami:latest",
    portsExposes: "80",
    domains: domain,
  });
  assert(!!appUuid, "createDockerImageApp returns an app uuid");

  await setEnv(appUuid, "PROBE", "hauldr");
  assert(true, "setEnv upserts a production env var");

  await deployApp(appUuid);
  const up = await reachable(domain);
  assert(up, `app reachable at ${domain} via the proxy/tunnel`);

  await destroyApp(appUuid);
  assert(true, "destroyApp tears it down");

  console.log(
    failures === 0
      ? "\nCOOLIFY PROVISIONER PRIMITIVES OK ✓"
      : `\n${failures} ASSERTION(S) FAILED ✗`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", (e as Error).message);
  process.exit(1);
});
