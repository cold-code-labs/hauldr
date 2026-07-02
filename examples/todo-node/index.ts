/**
 * Minimal Hauldr example — sign up, then read/write RLS-protected data through
 * the SDK. Point it at a provisioned project:
 *
 *   HAULDR_URL=<project GoTrue URL> \
 *   HAULDR_DB_URL=<project pooled connection string> \
 *   pnpm tsx index.ts
 *
 * Get those two values from `pnpm cli create <name>` in ../../control-plane
 * (the `auth.gotrueUrl` and `connectionString` fields).
 */
import { createClient } from "../../packages/client/src/index";

const url = process.env.HAULDR_URL;
const connectionString = process.env.HAULDR_DB_URL;
if (!url || !connectionString) {
  console.error("Set HAULDR_URL and HAULDR_DB_URL (see the header of this file).");
  process.exit(1);
}

const hauldr = createClient({ url, db: { connectionString } });

// A fresh user each run.
const email = `user_${process.pid}@example.com`;
const { access_token, user } = await hauldr.auth.signUp({ email, password: "supersecret" });
console.log("signed up:", user.id);

// Writes default `owner` to the caller's id; RLS keeps reads scoped to them.
await hauldr.db.asUser(access_token).insert("todos", { title: "my first todo" });
const todos = await hauldr.db.asUser(access_token).select<{ title: string }>("todos");
console.log("you have", todos.length, "todo(s):", todos.map((t) => t.title));

await hauldr.db.end();
