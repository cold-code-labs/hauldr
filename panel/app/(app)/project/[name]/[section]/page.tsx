import { notFound } from "next/navigation";
import { getProject } from "../../../../../lib/api";
import { sectionTitle } from "../../../../../lib/nav";
import { Icon } from "../../../../icons";
import { ServicesClient } from "./ServicesClient";

export const dynamic = "force-dynamic";

export default async function ProjectSection({
  params,
}: {
  params: Promise<{ name: string; section: string }>;
}) {
  const { name, section } = await params;
  const title = sectionTitle(section);
  if (!title) notFound();

  // Services is live — it manages the project's à-la-carte sidecars.
  if (section === "services") {
    const detail = await getProject(name);
    if (!detail) notFound();
    return <ServicesClient name={name} initial={detail} />;
  }

  return (
    <>
      <header className="topbar">
        <div>
          <h1>{title}</h1>
          <div className="sub mono">{name}</div>
        </div>
        <span className="badge">
          <span className="dot" /> Planned
        </span>
      </header>

      <div className="content">
        <div className="card coming">
          <div className="ring">
            <Icon name="shield" />
          </div>
          <h2>{title}</h2>
          <p>
            This surface is on the roadmap and lands in an upcoming slice. The
            foundation — the project’s database, auth and RLS — is already live.
          </p>
        </div>
      </div>
    </>
  );
}
