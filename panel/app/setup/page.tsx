import { redirect } from "next/navigation";
import { getSystem } from "../../lib/api";
import { ShieldMark } from "../icons";
import { SetupForm } from "./SetupForm";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const system = await getSystem();
  // Already set up → there's nothing to do here; send people to sign in.
  if (system.reachable && system.initialized) redirect("/login");

  return (
    <div className="login-wrap">
      <div className="login-card login-card-wide">
        <div className="brand">
          <ShieldMark />
          <span className="brand-word">Hauldr</span>
        </div>
        <p className="login-tag">Set up your install — one time only.</p>
        {system.reachable ? (
          <SetupForm />
        ) : (
          <div className="form-error" style={{ marginTop: 0 }}>
            Control plane unreachable — start it, then reload.
          </div>
        )}
        <p className="login-foot">
          This creates your master operator and your first organization.
        </p>
      </div>
    </div>
  );
}
