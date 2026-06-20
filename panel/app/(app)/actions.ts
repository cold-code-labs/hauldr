"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE } from "../../lib/session";
import { ORG_COOKIE } from "../../lib/org";

export async function logoutAction() {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

/** Switch the active organization (panel-side view scope) and reset to the dashboard. */
export async function setOrgAction(orgId: string) {
  (await cookies()).set(ORG_COOKIE, orgId, {
    path: "/",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect("/");
}
