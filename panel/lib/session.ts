import crypto from "node:crypto";
import { cookies } from "next/headers";

export const SESSION_COOKIE = "hauldr_session";
const SECRET = process.env.HAULDR_JWT_SECRET || "";

export type Session = {
  sub: string;
  email?: string;
  role?: string;
  exp?: number;
};

/** Verify a GoTrue HS256 JWT against the shared secret and expiry. */
export function verify(token: string): Session | null {
  if (!SECRET) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;

  const expected = crypto
    .createHmac("sha256", SECRET)
    .update(`${h}.${p}`)
    .digest("base64url");
  const a = Buffer.from(s);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  try {
    const claims = JSON.parse(Buffer.from(p, "base64url").toString("utf8"));
    if (claims.exp && claims.exp * 1000 < Date.now()) return null;
    return claims as Session;
  } catch {
    return null;
  }
}

/** Current operator session from the cookie, or null. */
export async function getSession(): Promise<Session | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? verify(token) : null;
}
