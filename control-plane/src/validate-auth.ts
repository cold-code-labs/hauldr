/**
 * Auth end-to-end test (GoTrue per project). Provisions two full projects —
 * each with its OWN GoTrue and JWT secret — then proves:
 *   - each project's GoTrue issues a JWT whose `sub` is the user id
 *   - that real token, injected as the RLS claim, gives correct per-user data
 *     isolation through the pooler (signup → token → RLS, end to end)
 *   - tokens are isolated per project (project A's token does not verify under
 *     project B's secret), and identities/data are isolated across projects
 *
 * Requires a running stack + Docker access for the auth provisioner.
 * Run:  pnpm validate:auth
 */
import pg from "pg";
import crypto from "node:crypto";
import { createProject, destroyProject } from "./provision";

const { Client } = pg;

let failures = 0;
function assert(cond: boolean, msg: string) {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures++;
}

function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  return JSON.parse(Buffer.from(payload, "base64url").toString());
}

/** Verify an HS256 JWT signature against a candidate secret (timing-safe). */
function verifyHs256(token: string, secret: string): boolean {
  const [h, p, sig] = token.split(".");
  const expect = crypto.createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
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

async function login(gotrueUrl: string, email: string, password: string): Promise<Session> {
  const r = await fetch(`${gotrueUrl}/token?grant_type=password`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(`login ${r.status}: ${await r.text()}`);
  return r.json() as Promise<Session>;
}

async function connectRetry(connectionString: string, tries = 10): Promise<pg.Client> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    const c = new Client({ connectionString });
    try {
      await c.connect();
      return c;
    } catch (e) {
      last = e;
      await c.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 750));
    }
  }
  throw last;
}

/** Run `fn` as `authenticated`, injecting the claims carried by a real GoTrue token. */
async function asToken(
  connectionString: string,
  token: string,
  fn: (c: pg.Client, claims: Record<string, unknown>) => Promise<void>,
) {
  const claims = decodeJwt(token);
  const c = await connectRetry(connectionString);
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
    await fn(c, claims);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

async function main() {
  await destroyProject("acme");
  await destroyProject("shop");
  const acme = await createProject("acme");
  const shop = await createProject("shop");

  assert(!!acme.auth && !!shop.auth, "each project provisioned its own GoTrue");
  if (!acme.auth || !shop.auth) throw new Error("auth not provisioned — is the auth provisioner enabled?");
  assert(acme.auth.jwtSecret !== shop.auth.jwtSecret, "each GoTrue has a distinct JWT secret");

  // signup in each project's GoTrue
  const alice = await signup(acme.auth.gotrueUrl, "alice@acme.test", "pw-alice-123");
  const sam = await signup(shop.auth.gotrueUrl, "sam@shop.test", "pw-sam-456");
  assert(!!alice.access_token, "acme GoTrue issued an access token on signup");
  const aliceClaims = decodeJwt(alice.access_token);
  assert(aliceClaims.sub === alice.user.id, "token sub equals the GoTrue user id");

  // per-project token isolation: acme's token verifies under acme, not shop
  assert(verifyHs256(alice.access_token, acme.auth.jwtSecret), "alice's token verifies under acme's secret");
  assert(!verifyHs256(alice.access_token, shop.auth.jwtSecret), "alice's token does NOT verify under shop's secret");

  // end-to-end: real GoTrue token → RLS through the pooler
  await asToken(acme.connectionString, alice.access_token, async (c, claims) => {
    await c.query("insert into todos(title) values ('alice-1'),('alice-2')");
    const { rows } = await c.query("select owner::text as owner, count(*)::int as n from todos group by owner");
    assert(
      rows.length === 1 && rows[0].owner === claims.sub && rows[0].n === 2,
      "alice's rows are owned by her GoTrue sub, and only she sees them",
    );
  });

  // lifecycle: a fresh login yields a working token too
  const aliceAgain = await login(acme.auth.gotrueUrl, "alice@acme.test", "pw-alice-123");
  await asToken(acme.connectionString, aliceAgain.access_token, async (c) => {
    const { rows } = await c.query("select count(*)::int as n from todos");
    assert(rows[0].n === 2, "alice re-logs in and still sees exactly her 2 rows");
  });

  // cross-project: sam (shop) is a distinct identity and sees nothing of acme's
  await asToken(shop.connectionString, sam.access_token, async (c, claims) => {
    const { rows } = await c.query("select count(*)::int as n from todos");
    assert(rows[0].n === 0, "sam sees 0 rows in shop (separate db + identity)");
    assert(claims.sub !== aliceClaims.sub, "sam and alice are distinct identities from distinct GoTrues");
  });

  console.log(
    failures === 0
      ? "\nALL AUTH (GoTrue-per-project) ASSERTIONS PASSED ✓"
      : `\n${failures} ASSERTION(S) FAILED ✗`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", (e as Error).message);
  process.exit(1);
});
