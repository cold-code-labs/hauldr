import crypto from "node:crypto";

/**
 * Supabase-shaped API keys. The `anon` and `service_role` keys a Supabase
 * project hands out are long-lived JWTs signed with the project's JWT secret,
 * carrying a single `role` claim. supabase-js sends them as the `apikey` header;
 * PostgREST, storage-api and Realtime all validate them with the same secret.
 *
 * Minting them from the project secret (rather than storing opaque keys) means a
 * migrated supabase-js app keeps keys shaped exactly like Supabase's, and the
 * keys are stable: the same secret always yields the same key, so re-provisioning
 * a service never invalidates an app's configured key.
 */

function b64url(input: string): string {
  return Buffer.from(input).toString("base64url");
}

/** Sign an HS256 JWT (the algorithm GoTrue, PostgREST and storage-api use). */
export function signHs256(payload: Record<string, unknown>, secret: string): string {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = b64url(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const sig = crypto.createHmac("sha256", secret).update(data).digest("base64url");
  return `${data}.${sig}`;
}

// iat fixed at the epoch and a far-future exp keep the key deterministic — no
// wall-clock read, and the same secret always produces byte-identical keys.
const FAR_FUTURE = 32503680000; // 3000-01-01

/** Mint a project's anon / service_role API key from its JWT secret. */
export function mintApiKey(role: "anon" | "service_role", secret: string): string {
  return signHs256({ role, iss: "hauldr", iat: 0, exp: FAR_FUTURE }, secret);
}
