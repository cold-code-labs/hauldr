import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { listProjects, destroyProject } from "./provision";
import { startProvision, getProjectDetail } from "./lifecycle";
import { provisionRest, destroyRest } from "./postgrest";
import { provisionRealtime, destroyRealtime } from "./realtime";
import { ensureMaster } from "./zero";
import { migrateProject } from "./migrate";
import { signMigrateToken, verifyMigrateToken } from "./migrate-auth";
import {
  listOrganizations,
  createOrganization,
  systemStatus,
  initSystem,
} from "./orgs";
import { config } from "./config";

const app = new Hono();

/**
 * Guard the management API with a bearer key. `/health` stays open so Coolify
 * and the compose can probe it. When no key is configured we fail closed on
 * /v1 (the API can create databases — never leave it open in production).
 */
app.use("/v1/*", async (c, next) => {
  // The migrate route authenticates itself (global key OR a per-project scoped
  // token), so it's exempt from the global-key-only guard here.
  if (c.req.method === "POST" && c.req.path.endsWith("/migrate")) return next();
  if (!config.apiKey) {
    return c.json({ error: "HAULDR_API_KEY not configured" }, 503);
  }
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token !== config.apiKey) {
    return c.json({ error: "unauthorized" }, 401);
  }
  await next();
});

/**
 * Once GoTrue (project zero) is reachable, ensure the master operator exists.
 * Runs in the background so it never blocks the API; best-effort with retries.
 */
async function ensureMasterWhenReady() {
  if (!config.jwtSecret || !config.masterPassword) return;
  for (let i = 0; i < 60; i++) {
    try {
      const h = await fetch(`${config.gotrueUrl}/health`);
      if (h.ok) {
        const r = await ensureMaster(config.masterEmail, config.masterPassword);
        console.log(`master ${config.masterEmail}: ${r.created ? "created" : "ready"}`);
        return;
      }
    } catch {
      // GoTrue not up yet — retry
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.warn("master bootstrap: GoTrue never became reachable");
}

app.get("/", (c) =>
  c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Hauldr</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, sans-serif;
    color: #e7e5e4; background: radial-gradient(1200px 600px at 50% -10%, #1c1917, #0c0a09); }
  main { max-width: 40rem; padding: 3rem 1.5rem; }
  h1 { font-size: clamp(2.5rem, 8vw, 4rem); margin: 0 0 .25rem; letter-spacing: -.03em; }
  .tag { color: #a8a29e; font-size: 1.15rem; margin: 0 0 2rem; }
  blockquote { border-left: 2px solid #44403c; margin: 0 0 2rem; padding: .25rem 0 .25rem 1rem;
    color: #d6d3d1; font-style: italic; }
  .meta { display: flex; gap: 1.25rem; flex-wrap: wrap; color: #78716c; font-size: .9rem; }
  a { color: #d6d3d1; }
  code { color: #fafaf9; background: #292524; padding: .1rem .4rem; border-radius: .3rem; font-size: .85em; }
</style></head>
<body><main>
  <h1>Hauldr</h1>
  <p class="tag">A multi-tenant, self-hostable backend on real Postgres.</p>
  <blockquote>In Old Norse law, a <strong>hauldr</strong> was a freeholder — someone who held
  their land outright, answering to no lord. Hauldr is a backend you hold the same way:
  your data, your Postgres, your box.</blockquote>
  <p>This is a live control plane. Projects are provisioned through its management API;
  each gets a database, row-level security, and its own auth — measured in megabytes, not gigabytes.</p>
  <div class="meta">
    <span><a href="https://github.com/cold-code-labs/hauldr">GitHub</a></span>
    <span>status: <a href="/health">/health</a></span>
    <span>pre-alpha</span>
  </div>
</main></body></html>`),
);

app.get("/health", (c) => c.json({ ok: true, service: "hauldr-control-plane" }));

// System / first-run. `/system` reports whether the install has been set up (a
// default organization exists); `/system/init` performs the one-time setup —
// create the master operator + the default organization (tenant zero).
app.get("/v1/system", async (c) => c.json(await systemStatus()));

app.post("/v1/system/init", async (c) => {
  const body = await c.req.json().catch(() => ({}) as Record<string, string>);
  try {
    const res = await initSystem({
      email: String(body.email ?? ""),
      password: String(body.password ?? ""),
      orgName: String(body.orgName ?? ""),
    });
    return c.json(res, 201);
  } catch (e) {
    const msg = (e as Error).message;
    return c.json({ error: msg }, msg === "already initialized" ? 409 : 400);
  }
});

// Organizations — the grouping above projects.
app.get("/v1/organizations", async (c) => c.json(await listOrganizations()));

app.post("/v1/organizations", async (c) => {
  const body = await c.req.json().catch(() => ({}) as { name?: string });
  if (!body?.name) return c.json({ error: "name required" }, 400);
  try {
    return c.json(await createOrganization(body.name), 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

app.get("/v1/projects", async (c) =>
  c.json(await listProjects(c.req.query("org") || undefined)),
);

app.get("/v1/projects/:name", async (c) => {
  const detail = await getProjectDetail(c.req.param("name"));
  if (!detail) return c.json({ error: "not found" }, 404);
  return c.json(detail);
});

// Provisioning is async: register the project, kick off the database + sidecars
// in the background, and return immediately so the caller can poll status. The
// optional `rest` flag also brings up the PostgREST sidecar.
app.post("/v1/projects", async (c) => {
  const body = await c.req
    .json()
    .catch(() => ({}) as { name?: string; rest?: boolean; organizationId?: string });
  if (!body?.name) return c.json({ error: "name required" }, 400);
  try {
    const res = await startProvision(body.name, {
      rest: !!body.rest,
      organizationId: body.organizationId || undefined,
    });
    return c.json(res, 202);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// Mint the project's scoped migrate token — the credential an app's deploy uses
// to apply its own schema (and that an operator can drop into the app env).
// Global-key gated; the token itself only authorizes migrate on this project.
app.get("/v1/projects/:name/migrate-token", (c) =>
  c.json({ name: c.req.param("name"), token: signMigrateToken(c.req.param("name")) }),
);

app.delete("/v1/projects/:name", async (c) => {
  try {
    const res = await destroyProject(c.req.param("name"));
    return c.json(res);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// À-la-carte services. PostgREST is the raw REST data layer — opt-in per project.
app.post("/v1/projects/:name/services/rest", async (c) => {
  try {
    const res = await provisionRest(c.req.param("name"));
    return c.json(res, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

app.delete("/v1/projects/:name/services/rest", async (c) => {
  try {
    await destroyRest(c.req.param("name"));
    return c.json({ name: c.req.param("name"), rest: "removed" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// Realtime — the SHARED multi-tenant Realtime service. Opt-in per project:
// registers the project as a tenant (broadcast / presence / postgres-changes).
app.post("/v1/projects/:name/services/realtime", async (c) => {
  try {
    const res = await provisionRealtime(c.req.param("name"));
    return c.json(res, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

app.delete("/v1/projects/:name/services/realtime", async (c) => {
  try {
    await destroyRealtime(c.req.param("name"));
    return c.json({ name: c.req.param("name"), realtime: "removed" });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

// Schema migration. The project DB is internal-only (no public Postgres), so an
// app applies its `db/migrations/NNNN_*.sql` through here instead of a public
// connection string — tracked + idempotent (re-sending the same name is a no-op).
//   curl -X POST .../v1/projects/<name>/migrate?name=0009_foo \
//        -H "Authorization: Bearer <key>" --data-binary @db/migrations/0009_foo.sql
app.post("/v1/projects/:name/migrate", async (c) => {
  const project = c.req.param("name");
  const auth = c.req.header("Authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const authorized =
    (!!config.apiKey && token === config.apiKey) || verifyMigrateToken(token, project);
  if (!authorized) return c.json({ error: "unauthorized" }, 401);

  const sql = await c.req.text();
  if (!sql.trim()) return c.json({ error: "empty SQL body" }, 400);
  try {
    const res = await migrateProject(project, sql, c.req.query("name") || undefined);
    return c.json(res, res.applied ? 201 : 200);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

serve({ fetch: app.fetch, port: config.apiPort });
console.log(`hauldr control-plane listening on :${config.apiPort}`);

void ensureMasterWhenReady();
