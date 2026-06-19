/**
 * REST end-to-end test (PostgREST per project, à-la-carte). Provisions a full
 * project (db + GoTrue), turns on its REST layer, then proves — through the HTTP
 * REST surface, not the db directly — that RLS holds:
 *   - the endpoint routes and serves its OpenAPI root
 *   - anon (no token) sees zero rows (RLS default-deny over REST)
 *   - a garbage bearer is rejected (the JWT gate is live)
 *   - a GoTrue-issued token lets a user POST then GET exactly their own rows,
 *     with `owner` defaulted to their JWT `sub`
 *   - a second user in the SAME project sees none of the first's rows (per-user
 *     isolation enforced by RLS through PostgREST)
 *
 * Uses whatever provisioner is configured: "docker" returns a localhost port and
 * is ready immediately; "coolify" deploys an app and routes it at its domain, so
 * the test waits for it. Run:  pnpm validate:rest
 */
import { createProject, destroyProject } from "./provision";
import { provisionRest, destroyRest } from "./postgrest";

let failures = 0;
function assert(cond: boolean, msg: string) {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures++;
}

function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString());
}

type Session = { access_token: string; user: { id: string } };

async function signup(gotrueUrl: string, email: string, password: string): Promise<Session> {
  const r = await fetch(`${gotrueUrl}/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`signup ${r.status}: ${await r.text()}`);
  return r.json() as Promise<Session>;
}

/** Wait for PostgREST to route and connect — its OpenAPI root answers 200. */
async function waitReachable(restUrl: string, tries = 60): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(`${restUrl}/`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) return true;
    } catch {
      // not routed yet
    }
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

function authHeaders(token?: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function getTodos(restUrl: string, token?: string): Promise<{ status: number; rows: any[] }> {
  const r = await fetch(`${restUrl}/todos?select=*`, { headers: authHeaders(token) });
  const rows = r.ok ? ((await r.json()) as any[]) : [];
  return { status: r.status, rows };
}

async function main() {
  await destroyProject("acme");
  const acme = await createProject("acme");
  if (!acme.auth) throw new Error("auth not provisioned — enable the auth provisioner");

  const rest = await provisionRest("acme");
  assert(!!rest.restUrl, `provisionRest returned an endpoint (${rest.restUrl})`);

  const up = await waitReachable(rest.restUrl);
  assert(up, `PostgREST routes and serves its OpenAPI root at ${rest.restUrl}`);
  if (!up) throw new Error("endpoint never became reachable");

  // anon (no token): RLS default-denies — endpoint answers, but no rows.
  const anon = await getTodos(rest.restUrl);
  assert(anon.status === 200 && anon.rows.length === 0, "anon sees 0 rows (RLS default-deny over REST)");

  // the JWT gate is live: a bogus bearer is rejected outright.
  const bogus = await getTodos(rest.restUrl, "not.a.jwt");
  assert(bogus.status === 401, "a garbage bearer is rejected (401)");

  // alice: a real GoTrue token → write + read her own data through REST.
  const alice = await signup(acme.auth.gotrueUrl, "alice@acme.test", "pw-alice-123");
  const aliceSub = decodeJwt(alice.access_token).sub as string;

  const ins = await fetch(`${rest.restUrl}/todos`, {
    method: "POST",
    headers: { ...authHeaders(alice.access_token), Prefer: "return=representation" },
    body: JSON.stringify({ title: "alice-rest-1" }),
  });
  const insRows = ins.ok ? ((await ins.json()) as any[]) : [];
  assert(ins.status === 201, `alice POSTs a todo through REST (status ${ins.status})`);
  assert(
    insRows.length === 1 && insRows[0].owner === aliceSub,
    "the inserted row's owner is defaulted to alice's JWT sub",
  );

  const aliceGet = await getTodos(rest.restUrl, alice.access_token);
  assert(
    aliceGet.rows.length === 1 && aliceGet.rows[0].owner === aliceSub,
    "alice GETs exactly her own row through REST",
  );

  // bob: a different user in the SAME project sees none of alice's rows.
  const bob = await signup(acme.auth.gotrueUrl, "bob@acme.test", "pw-bob-456");
  const bobGet = await getTodos(rest.restUrl, bob.access_token);
  assert(bobGet.rows.length === 0, "bob sees 0 of alice's rows (per-user RLS through REST)");

  // teardown
  await destroyRest("acme");
  await destroyProject("acme");

  console.log(
    failures === 0
      ? "\nALL REST (PostgREST-per-project) ASSERTIONS PASSED ✓"
      : `\n${failures} ASSERTION(S) FAILED ✗`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", (e as Error).message);
  process.exit(1);
});
