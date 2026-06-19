import { redirect } from "next/navigation";
import { getSession } from "../../lib/session";
import { ShieldMark } from "../icons";
import { LoginForm } from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getSession()) redirect("/");

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
