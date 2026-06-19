import { redirect } from "next/navigation";
import { getSession } from "../../lib/session";
import { Sidebar } from "./Sidebar";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect("/login");

  return (
    <div className="shell">
      <Sidebar email={session.email || "operator"} />
      <div className="main">{children}</div>
    </div>
  );
}
