import { notFound } from "next/navigation";
import { getProject } from "../../../../lib/api";
import { ProjectOverview } from "./ProjectOverview";

export const dynamic = "force-dynamic";

export default async function ProjectPage({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const detail = await getProject(name);
  if (!detail) notFound();
  return <ProjectOverview name={name} initial={detail} />;
}
