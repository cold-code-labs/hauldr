"use server";

import { redirect } from "next/navigation";
import { getSystem, initSystem } from "../../lib/api";
import { passwordGrant, setSession } from "../../lib/auth";

export type SetupState = { error?: string };

/**
 * First-run setup: create the master operator + the first organization
 * (tenant zero), then sign the operator straight in. Refuses once the install
 * is already initialized.
 */
export async function setupAction(
  _prev: SetupState,
  formData: FormData,
): Promise<SetupState> {
  const orgName = String(formData.get("orgName") || "").trim();
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm") || "");

  if (!orgName) return { error: "Name your organization." };
  if (!email || !password) return { error: "Enter the master email and password." };
  if (password.length < 8) return { error: "Use a password of at least 8 characters." };
  if (password !== confirm) return { error: "Passwords don't match." };

  const system = await getSystem();
  if (!system.reachable) return { error: "Control plane unreachable." };
  if (system.initialized) redirect("/login");

  const res = await initSystem({ email, password, orgName });
  if (!res.ok) return { error: res.error };

  // Set up succeeded — sign the new master in and land on the dashboard.
  const token = await passwordGrant(email, password);
  if (token) {
    await setSession(token);
    redirect("/");
  }
  redirect("/login");
}
