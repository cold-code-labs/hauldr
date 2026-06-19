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
