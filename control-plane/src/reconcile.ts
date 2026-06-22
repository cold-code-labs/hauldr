import { routeDomainsFor, type ServiceKind } from "./config";
import { findAppByName, getAppDomains, updateAppDomains, deployApp } from "./coolify";
import { projectIdentity } from "./gotrue";
import { listProjects } from "./provision";

/**
 * Reconcile — re-apply the CURRENT routing shape to a project's existing service
 * sidecars, healing drift from projects provisioned before the shape evolved
 * (e.g. the Supabase-dialect `/<service>/v1` alias added after the first apps
 * were created).
 *
 * Domain-only: it recomputes routeDomainsFor() and, when an existing sidecar's
 * routed domains differ, PATCHes them + redeploys (the redeploy regenerates the
 * Traefik labels). It NEVER touches envs, the JWT secret, or the database — so
 * it is safe against a live project; the only effect is a brief sidecar restart.
 * Idempotent: a service already on the right domains is left untouched (no
 * redeploy), so reconciling the whole fleet only bounces what actually drifted.
 */

const SERVICES: ServiceKind[] = ["auth", "rest", "storage"];

export interface ServiceReconcile {
  service: ServiceKind;
  appUuid: string;
  before: string[];
  after: string[];
  changed: boolean;
}

export interface ProjectReconcile {
  name: string;
  base: string;
  env: string;
  services: ServiceReconcile[];
  /** True when the project has no Coolify-routed service sidecars (nothing to do). */
  skipped: boolean;
}

export async function reconcileProject(name: string): Promise<ProjectReconcile> {
  const { base, env } = await projectIdentity(name);
  const services: ServiceReconcile[] = [];

  for (const svc of SERVICES) {
    const appUuid = await findAppByName(`hauldr-${svc}-${name}`);
    if (!appUuid) continue; // this project never opted into this service

    const before = (await getAppDomains(appUuid)).map((d) => d.trim()).sort();
    const want = routeDomainsFor(base, env, svc);
    const after = [...want].sort();
    const changed = before.join("|") !== after.join("|");

    if (changed) {
      await updateAppDomains(appUuid, want.join(","));
      await deployApp(appUuid);
    }
    services.push({ service: svc, appUuid, before, after, changed });
  }

  return { name, base, env, services, skipped: services.length === 0 };
}

/** Reconcile every registered project (the fleet drift sweep). */
export async function reconcileAll(): Promise<ProjectReconcile[]> {
  const projects = (await listProjects()) as Array<{ name: string }>;
  const out: ProjectReconcile[] = [];
  for (const p of projects) out.push(await reconcileProject(p.name));
  return out;
}
