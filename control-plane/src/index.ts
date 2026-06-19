import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createProject, listProjects, destroyProject } from "./provision";
import { ensureMaster } from "./zero";
import { config } from "./config";

const app = new Hono();

/**
 * Guard the management API with a bearer key. `/health` stays open so Coolify
 * and the compose can probe it. When no key is configured we fail closed on
 * /v1 (the API can create databases — never leave it open in production).
 */
app.use("/v1/*", async (c, next) => {
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

app.get("/v1/projects", async (c) => c.json(await listProjects()));

app.post("/v1/projects", async (c) => {
  const body = await c.req.json().catch(() => ({}) as { name?: string });
  if (!body?.name) return c.json({ error: "name required" }, 400);
  try {
    const res = await createProject(body.name);
    return c.json(res, 201);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

app.delete("/v1/projects/:name", async (c) => {
  try {
    const res = await destroyProject(c.req.param("name"));
    return c.json(res);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

serve({ fetch: app.fetch, port: config.apiPort });
console.log(`hauldr control-plane listening on :${config.apiPort}`);

void ensureMasterWhenReady();
