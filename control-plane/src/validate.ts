/**
 * Data-plane smoke test. Provisions two projects (database only), then connects
 * THROUGH the pooler and proves:
 *   - RLS isolates rows by the JWT `sub` claim (user A cannot see user B's rows)
 *   - each project lands on its own database (cross-project isolation)
 *
 * Run against a running stack:  HAULDR_AUTH_PROVISIONER=none pnpm validate
 */
import pg from "pg";
import { provisionDatabase, destroyProject, listProjects } from "./provision";

const { Client } = pg;

let failures = 0;
function assert(cond: boolean, msg: string) {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures++;
}

/** Connect through the pooler, retrying while a freshly-registered tenant propagates. */
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

/** Run `fn` in a transaction acting as `authenticated` with `sub` injected as the claim. */
async function asUser(
  connectionString: string,
  sub: string,
  fn: (c: pg.Client) => Promise<void>,
) {
  const c = await connectRetry(connectionString);
  try {
    await c.query("begin");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub }),
    ]);
    await fn(c);
    await c.query("commit");
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    await c.end();
  }
}

const USER_A = "11111111-1111-1111-1111-111111111111";
const USER_B = "22222222-2222-2222-2222-222222222222";

async function main() {
  // Clean slate (idempotent — no-op if absent), then provision two databases.
  await destroyProject("acme");
  await destroyProject("shop");
  const acme = await provisionDatabase("acme");
  const shop = await provisionDatabase("shop");
  assert(acme.pooled && shop.pooled, "both projects routed through the pooler");
  assert(
    acme.database === "db_acme" && shop.database === "db_shop",
    "each project provisioned its own database (db_acme, db_shop)",
  );

  // 1) RLS within acme — user A inserts and sees only their rows.
  await asUser(acme.connectionString, USER_A, async (c) => {
    await c.query("insert into todos(title) values ('a-one'),('a-two')");
    const { rows } = await c.query("select count(*)::int n from todos");
    assert(rows[0].n === 2, "acme / user A sees exactly their 2 rows");
  });

  // 2) user B in the SAME project sees none of A's rows, adds one of their own.
  await asUser(acme.connectionString, USER_B, async (c) => {
    const before = await c.query("select count(*)::int n from todos");
    assert(before.rows[0].n === 0, "acme / user B sees 0 rows (RLS isolates by owner)");
    await c.query("insert into todos(title) values ('b-one')");
  });

  // 3) back as A — still only A's 2 rows, never B's.
  await asUser(acme.connectionString, USER_A, async (c) => {
    const { rows } = await c.query("select count(*)::int n from todos");
    assert(rows[0].n === 2, "acme / user A still sees only their 2 rows, not B's");
    const db = await c.query("select current_database() as db");
    assert(db.rows[0].db === "db_acme", "acme connection lands on db_acme");
  });

  // 4) cross-project isolation — shop is a separate database; A sees nothing there.
  await asUser(shop.connectionString, USER_A, async (c) => {
    const { rows } = await c.query("select count(*)::int n from todos");
    assert(rows[0].n === 0, "shop / user A sees 0 rows (separate database)");
    const db = await c.query("select current_database() as db");
    assert(db.rows[0].db === "db_shop", "shop connection lands on db_shop, not db_acme");
  });

  const names = (await listProjects()).map((p: { name: string }) => p.name).sort();
  console.log(`\nregistry: ${names.join(", ")}`);
  console.log(failures === 0 ? "\nALL DATA-PLANE ASSERTIONS PASSED ✓" : `\n${failures} ASSERTION(S) FAILED ✗`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", (e as Error).message);
  process.exit(1);
});
