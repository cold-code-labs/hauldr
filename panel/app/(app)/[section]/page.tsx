import { notFound } from "next/navigation";
import { sectionTitle } from "../../../lib/nav";
import { Icon } from "../../icons";

export const dynamic = "force-dynamic";

export default async function SectionPage({
  params,
}: {
  params: Promise<{ section: string }>;
}) {
  const { section } = await params;
  const title = sectionTitle(section);
  if (!title) notFound();

  return (
    <>
      <header className="topbar">
        <div>
          <h1>{title}</h1>
          <div className="sub">Part of the Hauldr control plane.</div>
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
            foundation — projects, auth and RLS — is already live.
          </p>
        </div>
      </div>
    </>
  );
}
