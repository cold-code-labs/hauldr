import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./session";

const GOTRUE = process.env.HAULDR_GOTRUE_URL || "http://localhost:9999";

/** Exchange email + password with project-zero GoTrue for an access token. */
export async function passwordGrant(
  email: string,
  password: string,
): Promise<string | null> {
  try {
    const res = await fetch(`${GOTRUE}/token?grant_type=password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()).access_token ?? null;
  } catch {
    return null;
  }
}

/** Persist the operator session cookie. Lifetime tracks GoTrue's JWT expiry. */
export async function setSession(token: string): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60,
  });
}
