import { redirect } from "next/navigation";
import { getSession } from "../../lib/session";
import { getSystem } from "../../lib/api";
import { ShieldMark } from "../icons";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSession()) redirect("/");
  // Before anyone can log in, the install must be set up (master + first org).
  const system = await getSystem();
  if (system.reachable && !system.initialized) redirect("/setup");

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">
          <ShieldMark />
          <span className="brand-word">Hauldr</span>
        </div>
        <p className="login-tag">The fortress for your data.</p>
        <LoginForm />
        <p className="login-foot">Open-source multi-tenant Postgres BaaS</p>
      </div>
    </div>
  );
}
