import { listOrganizations } from "../../../lib/api";
import { currentOrgId, resolveOrg } from "../../../lib/org";
import { OrganizationsClient } from "./OrganizationsClient";

export const dynamic = "force-dynamic";

export default async function OrganizationsPage() {
  const orgs = await listOrganizations();
  const active = resolveOrg(orgs, await currentOrgId());

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Organizations</h1>
          <div className="sub">Every organization you operate — pick one to work in.</div>
        </div>
        <span className="badge ok">
          <span className="dot" /> Control plane online
        </span>
      </header>
      <OrganizationsClient initial={orgs} activeId={active?.id ?? null} />
    </>
  );
}
