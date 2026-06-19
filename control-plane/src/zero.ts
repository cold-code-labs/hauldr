import crypto from "node:crypto";
import { adminClient, dbClient } from "./db";
import { config } from "./config";

/**
 * Project zero — the panel's own project. The installer brings it up at
 * bootstrap: a dedicated database with its own GoTrue (auth schema + JWT
 * secret), isolated from tenants by construction. There is no "special"
 * platform auth — the panel authenticates against project zero like any app.
 */

/**
 * Prepare the project-zero database for GoTrue:
 *  - the database exists,
 *  - an empty `auth` schema exists (GoTrue's first migration assumes it),
 *  - search_path points at `auth` so GoTrue's runtime queries AND its own
 *    migration tracking resolve to the same schema (mixing them breaks
 *    non-idempotent migrations on restart).
 * Idempotent.
 */
export async function ensureProjectZero(): Promise<void> {
  const admin = adminClient();
  await admin.connect();
  try {
    const d = await admin.query(
      "select 1 from pg_database where datname = $1",
      [config.zeroDb],
    );
    if (!d.rowCount) {
      await admin.query(`create database "${config.zeroDb}"`);
    }
    await admin.query(
      `alter database "${config.zeroDb}" set search_path = auth, public`,
    );
  } finally {
    await admin.end();
  }

  const z = dbClient(config.zeroDb);
  await z.connect();
  try {
    await z.query("create schema if not exists auth");
  } finally {
    await z.end();
  }
}

/** A short-lived service_role JWT (HS256) for GoTrue's admin API. */
function serviceRoleToken(): string {
  if (!config.jwtSecret) throw new Error("HAULDR_JWT_SECRET is not set");
  const b64 = (s: string) => Buffer.from(s).toString("base64url");
  const header = b64(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const now = Math.floor(Date.now() / 1000);
  const payload = b64(
    JSON.stringify({ role: "service_role", iss: "hauldr", iat: now, exp: now + 600 }),
  );
  const sig = crypto
    .createHmac("sha256", config.jwtSecret)
    .update(`${header}.${payload}`)
    .digest("base64url");
  return `${header}.${payload}.${sig}`;
}

/**
 * Ensure the master operator account exists in project zero's GoTrue.
 * Created confirmed via the admin API (public signup stays disabled).
 * Idempotent: a pre-existing account is treated as success.
 */
export async function ensureMaster(
  email: string,
  password: string,
): Promise<{ created: boolean }> {
  if (!password) throw new Error("master password is empty (set HAULDR_MASTER_PASSWORD)");

  const res = await fetch(`${config.gotrueUrl}/admin/users`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleToken()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });

  if (res.status === 200 || res.status === 201) return { created: true };

  // GoTrue answers 422 when the user already exists — idempotent success.
  const body = await res.text();
  if (res.status === 422 && /already.*registered|exists/i.test(body)) {
    return { created: false };
  }
  throw new Error(`GoTrue admin createUser failed (${res.status}): ${body}`);
}
