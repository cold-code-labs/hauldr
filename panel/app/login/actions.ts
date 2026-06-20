"use server";

import { redirect } from "next/navigation";
import { passwordGrant, setSession } from "../../lib/auth";

export type LoginState = { error?: string };

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  if (!email || !password) return { error: "Enter your email and password." };

  const token = await passwordGrant(email, password);
  if (!token) return { error: "Invalid email or password." };

  await setSession(token);
  redirect("/");
}
