import { cookies } from "next/headers";
import type { Org } from "./api";

/** The currently-selected organization is held in a cookie; it resolves to the
 *  default org when unset or stale. Org selection is just a panel-side view
 *  scope — projects carry their real organization_id in the control db. */
export const ORG_COOKIE = "hauldr_org";

export async function currentOrgId(): Promise<string | null> {
  return (await cookies()).get(ORG_COOKIE)?.value ?? null;
}

/** Resolve the active org: the cookie's org if it still exists, else the default. */
export function resolveOrg(orgs: Org[], id: string | null): Org | null {
  if (!orgs.length) return null;
  return (
    orgs.find((o) => o.id === id) ?? orgs.find((o) => o.is_default) ?? orgs[0]
  );
}
