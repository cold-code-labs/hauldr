"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "../../lib/session";

const GOTRUE = process.env.HAULDR_GOTRUE_URL || "http://localhost:9999";

export type LoginState = { error?: string };

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  if (!email || !password) return { error: "Enter your email and password." };

  let token: string | undefined;
  try {
    const res = await fetch(`${GOTRUE}/token?grant_type=password`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
      cache: "no-store",
    });
    if (!res.ok) return { error: "Invalid email or password." };
    token = (await res.json()).access_token;
  } catch {
    return { error: "Auth service unreachable." };
  }
  if (!token) return { error: "Invalid email or password." };

  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60,
  });
  redirect("/");
}
