import { redirect } from "next/navigation";
import { getSession } from "../../lib/session";
import { getSystem, listOrganizations } from "../../lib/api";
import { currentOrgId, resolveOrg } from "../../lib/org";
import { Sidebar } from "./Sidebar";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Uninitialized install → first-run wizard, before anything else.
  const system = await getSystem();
  if (system.reachable && !system.initialized) redirect("/setup");

  const session = await getSession();
  if (!session) redirect("/login");

  const orgs = await listOrganizations();
  const currentOrg = resolveOrg(orgs, await currentOrgId());

  return (
    <div className="shell">
      <Sidebar
        email={session.email || "operator"}
        orgs={orgs}
        currentOrg={currentOrg}
      />
      <div className="main">{children}</div>
    </div>
  );
}
