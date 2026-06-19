/**
 * SDK end-to-end test. Drives `@hauldr/client` exactly as an application
 * developer would, against a freshly provisioned project, and proves the SDK
 * contract: auth via the project's GoTrue, and data with RLS applied
 * automatically (no manual claim handling).
 *
 * Run:  pnpm validate:sdk
 */
import { createClient } from "../../packages/client/src/index";
import { createProject, destroyProject } from "./provision";

let failures = 0;
function assert(cond: boolean, msg: string) {
  console.log(`${cond ? "✓" : "✗"} ${msg}`);
  if (!cond) failures++;
}

async function main() {
  await destroyProject("demo");
  const demo = await createProject("demo");
  if (!demo.auth) throw new Error("auth not provisioned — enable the auth provisioner");

  // The SDK, as an app would construct it.
  const hauldr = createClient({
    url: demo.auth.gotrueUrl,
    db: { connectionString: demo.connectionString },
  });

  // Auth lifecycle (browser-safe surface).
  const alice = await hauldr.auth.signUp({ email: "alice@demo.test", password: "pw-alice-123" });
  const bob = await hauldr.auth.signUp({ email: "bob@demo.test", password: "pw-bob-456" });
  assert(!!alice.access_token && !!bob.access_token, "auth.signUp returns a session for two users");

  const who = await hauldr.auth.getUser(alice.access_token);
  assert(who.id === alice.user.id, "auth.getUser resolves the signed-in user");

  // Data — RLS is invisible but enforced. Alice writes and reads her row.
  const created = await hauldr.db
    .asUser(alice.access_token)
    .insert<{ id: string; title: string; owner: string }>("todos", { title: "written via SDK" });
  assert(created.title === "written via SDK", "db.insert round-trips a row");
  assert(created.owner === alice.user.id, "the row is owned by alice's id (default from her claim)");

  const aliceRows = await hauldr.db.asUser(alice.access_token).select("todos");
  assert(aliceRows.length === 1, "db.select returns alice's 1 row");

  // Bob, through the same SDK, sees none of alice's data.
  const bobRows = await hauldr.db.asUser(bob.access_token).select("todos");
  assert(bobRows.length === 0, "bob sees 0 rows — RLS enforced through the SDK, no manual claims");

  // The pre-alpha namespaces fail loudly rather than silently.
  let stubbed = false;
  try {
    await hauldr.files.upload("avatars", {});
  } catch {
    stubbed = true;
  }
  assert(stubbed, "files namespace throws a clear not-implemented (pre-alpha)");

  await hauldr.db.end();
  await destroyProject("demo");

  console.log(
    failures === 0 ? "\nALL SDK ASSERTIONS PASSED ✓" : `\n${failures} ASSERTION(S) FAILED ✗`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("FAILED:", (e as Error).message);
  process.exit(1);
});
