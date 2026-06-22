import crypto from "node:crypto";
import { config } from "./config";

// Per-project migrate token. A long-lived credential that authorizes ONLY the
// migrate route, and ONLY for one project — so an app's deploy can apply its own
// schema without holding the global management key (which can create/destroy any
// project). Stateless HMAC over {project, scope}; revoke by rotating
// HAULDR_MIGRATE_SECRET. Falls back to the management API key as the signing
// secret so it works with no extra config (rotating the API key rotates these).

function secret(): string {
  return config.migrateSecret || config.apiKey;
}

/** Mint a scoped migrate token for a project. Empty when no secret is set. */
export function signMigrateToken(project: string): string {
  if (!secret()) return "";
  const body = Buffer.from(JSON.stringify({ p: project, s: "migrate" })).toString("base64url");
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** True iff `token` is a valid migrate token for exactly `project`. */
export function verifyMigrateToken(token: string, project: string): boolean {
  if (!secret() || !token) return false;
  const [body, sig] = token.split(".");
  if (!body || !sig) return false;
  const expected = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      p?: string;
      s?: string;
    };
    return claims.s === "migrate" && claims.p === project;
  } catch {
    return false;
  }
}
