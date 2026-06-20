import { listOrganizations, listProjects } from "../../../lib/api";
import { currentOrgId, resolveOrg } from "../../../lib/org";
import { ProjectsList } from "./ProjectsList";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const orgs = await listOrganizations();
  const org = resolveOrg(orgs, await currentOrgId());
  const projects = await listProjects(org?.id ?? null);

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Projects</h1>
          <div className="sub">
            Each project is an isolated Postgres database with its own auth.
          </div>
        </div>
        <span className="badge ok">
          <span className="dot" /> Control plane online
        </span>
      </header>
      <ProjectsList initial={projects} orgName={org?.name ?? "this organization"} />
    </>
  );
}
