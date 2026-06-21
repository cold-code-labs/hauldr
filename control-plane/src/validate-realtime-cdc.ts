/**
 * Realtime end-to-end test — postgres-changes (CDC), RLS-filtered.
 *
 * Proves the wal2json path: a row written to the project's Postgres is decoded by
 * Realtime's `postgres_cdc_rls` driver and pushed to a subscribed client over the
 * socket — and ONLY to clients whose token may SELECT that row (RLS).
 *
 *   1. alice subscribes to changes on `todos`,
 *   2. a row owned by alice is inserted → alice receives the INSERT,
 *   3. a row owned by someone else is inserted → alice does NOT receive it.
 *
 * Needs the table in the `supabase_realtime` publication and a Postgres with
 * wal2json. Runs where it can reach BOTH the public Realtime edge (WSS) and the
 * project database (CDC_DB_URL — e.g. inside the server network).
 *
 * Run:
 *   REALTIME_URL=https://realtime-tpldev.coldcodelabs.com \
 *   REALTIME_JWT_SECRET=<project jwt secret> \
 *   CDC_DB_URL=postgres://postgres:<pw>@hauldr-db:5432/db_tpldev \
 *   pnpm validate:realtime:cdc
 */
import crypto from "node:crypto";
import { Client } from "pg";
import { createClient } from "../../packages/client/src/index";

const URL = process.env.REALTIME_URL ?? "https://realtime-tpldev.coldcodelabs.com";
const SECRET = process.env.REALTIME_JWT_SECRET ?? "";
const DB_URL = process.env.CDC_DB_URL ?? "";
if (!SECRET || !DB_URL) {
  console.error("set REALTIME_JWT_SECRET and CDC_DB_URL");
  process.exit(2);
}

let failures = 0;
function assert(cond: boolean, msg: string) {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures++;
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
function mint(sub: string): string {
  const now = Math.floor(Date.now() / 1000);
  const data = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ role: "authenticated", sub, exp: now + 3600, iat: now })}`;
  const sig = crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
  return `${data}.${sig}`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const aliceId = "11111111-1111-1111-1111-111111111111";
  const bobId = "22222222-2222-2222-2222-222222222222";
  const aliceToken = mint(aliceId);
  const stamp = Date.now();

  const app = createClient({ url: "https://unused.invalid", realtime: { url: URL, accessToken: aliceToken } });
  const db = new Client({ connectionString: DB_URL });
  await db.connect();

  // Collect every change Realtime pushes to alice's subscription.
  const got: Array<{ title?: string; owner?: string }> = [];
  const sub = app.live.onChanges(
    `cdc-${stamp}`,
    { schema: "public", table: "todos", event: "INSERT" },
    (c) => got.push({ title: c.record?.title as string, owner: c.record?.owner as string }),
  );
  await sleep(2500); // socket join + CDC subscription registration

  const aliceTitle = `alice-cdc-${stamp}`;
  const bobTitle = `bob-cdc-${stamp}`;
  // Inserted by a superuser connection (bypasses RLS on write); owner is set
  // explicitly, so RLS on READ decides who the change is delivered to.
  await db.query("insert into todos(owner, title) values ($1, $2)", [aliceId, aliceTitle]);
  await db.query("insert into todos(owner, title) values ($1, $2)", [bobId, bobTitle]);

  await sleep(4000); // let the WAL decode + deliver

  assert(
    got.some((g) => g.title === aliceTitle && g.owner === aliceId),
    "alice receives the INSERT of HER row (postgres-changes delivers)",
  );
  assert(
    !got.some((g) => g.title === bobTitle),
    "alice does NOT receive bob's row (RLS filters the change stream)",
  );

  sub.unsubscribe();
  // Tidy the test rows.
  await db.query("delete from todos where title = any($1)", [[aliceTitle, bobTitle]]);
  await db.end();

  console.log(
    failures === 0 ? "\nALL CDC ASSERTIONS PASSED ✓" : `\n${failures} ASSERTION(S) FAILED ✗`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", (e as Error).message);
  process.exit(1);
});
