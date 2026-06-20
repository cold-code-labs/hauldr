import { listOrganizations, listProjects } from "../../lib/api";
import { currentOrgId, resolveOrg } from "../../lib/org";
import { DashboardClient } from "./DashboardClient";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const orgs = await listOrganizations();
  const org = resolveOrg(orgs, await currentOrgId());
  const projects = await listProjects(org?.id ?? null);

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Dashboard</h1>
          <div className="sub">{org?.name ?? "Organization"} — at a glance.</div>
        </div>
        <span className="badge ok">
          <span className="dot" /> Control plane online
        </span>
      </header>
      <DashboardClient initial={projects} />
    </>
  );
}
