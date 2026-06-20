"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { ProjectDetail } from "../../../../lib/api";
import { Icon } from "../../../icons";

function Copy({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="copybtn"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {done ? "Copied" : "Copy"}
    </button>
  );
}

function StatusBadge({ status }: { status: string }) {
  const label =
    status === "live" ? "Live" : status === "error" ? "Error" : "Provisioning";
  return (
    <span className={`sbadge ${status}`}>
      <span className="sdot" />
      {label}
    </span>
  );
}

export function ProjectOverview({
  name,
  initial,
}: {
  name: string;
  initial: ProjectDetail;
}) {
  const router = useRouter();
  const [d, setD] = useState<ProjectDetail>(initial);
  const [tearing, setTearing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provisioning = d.status === "provisioning";

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${encodeURIComponent(name)}`, { cache: "no-store" });
    if (res.ok) setD(await res.json());
  }, [name]);

  // Keep the overview live while the project (or a newly-added sidecar) comes up.
  useEffect(() => {
    const needsPoll = provisioning || d.services.rest?.ready === false;
    if (!needsPoll) return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [provisioning, d.services.rest?.ready, refresh]);

  async function teardown() {
    setTearing(true);
    setError(null);
    const res = await fetch(`/api/projects/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "teardown failed");
      setTearing(false);
      return;
    }
    router.push("/projects");
    router.refresh();
  }

  const auth = d.services.auth;
  const rest = d.services.rest;
  const isErr = d.status === "error";

  return (
    <>
      <header className="topbar">
        <div>
          <h1>{name}</h1>
          <div className="sub mono">{d.database}</div>
        </div>
        <StatusBadge status={d.status} />
      </header>

      <div className="content">
        {isErr && (
          <div className="card card-pad form-error" style={{ margin: "0 0 20px" }}>
            Provisioning failed: {d.statusDetail || "unknown error"}
          </div>
        )}

        <div className="section-title">
          <h2>Connection</h2>
        </div>
        <div className="card card-pad endpoints">
          {auth?.url && (
            <div className="endpoint">
              <span className="ekey">
                Auth
                <span className={`rdot ${auth.ready ? "up" : ""}`} />
              </span>
              <div className="copyfield">
                <code>{auth.url}</code>
                <Copy value={auth.url} />
              </div>
            </div>
          )}
          {rest?.url ? (
            <div className="endpoint">
              <span className="ekey">
                REST
                <span className={`rdot ${rest.ready ? "up" : ""}`} />
              </span>
              <div className="copyfield">
                <code>{rest.url}</code>
                <Copy value={rest.url} />
              </div>
            </div>
          ) : (
            <div className="endpoint">
              <span className="ekey">REST</span>
              <div className="endpoint-off">
                {rest ? "coming up…" : "not enabled"} —{" "}
                <Link href={`/project/${encodeURIComponent(name)}/services`} className="link">
                  manage in Services
                </Link>
              </div>
            </div>
          )}
          {d.internal?.dbUrl && (
            <div className="endpoint">
              <span className="ekey">Internal DB</span>
              <div className="copyfield">
                <code>{d.internal.dbUrl}</code>
                <Copy value={d.internal.dbUrl} />
              </div>
            </div>
          )}
          <div className="detail-note">
            {d.status === "live" ? (
              <>
                <b>Internal-first:</b> apps on this server reach the database at{" "}
                <b>
                  {d.internal?.dbHost ?? "hauldr-db"}:{d.internal?.dbPort ?? 5432}
                </b>{" "}
                over the private network — no public DB route.
              </>
            ) : (
              <>Bringing up the sidecars… this page updates itself.</>
            )}
          </div>
        </div>

        <div className="section-title" style={{ marginTop: 28 }}>
          <h2>Danger zone</h2>
        </div>
        <div className="card card-pad danger">
          <div className="danger-text">
            <b>Tear down this project</b>
            <span>
              Drops the database, its auth, and any REST sidecar. This can’t be undone.
            </span>
          </div>
          {confirm ? (
            <div className="danger-confirm">
              <button className="btn btn-ghost" onClick={() => setConfirm(false)} disabled={tearing}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={teardown} disabled={tearing}>
                {tearing ? "Tearing down…" : "Yes, tear down"}
              </button>
            </div>
          ) : (
            <button className="btn btn-danger-ghost" onClick={() => setConfirm(true)}>
              <Icon name="trash" /> Tear down
            </button>
          )}
        </div>
        {error && (
          <div className="form-error" style={{ marginTop: 14 }}>
            {error}
          </div>
        )}
      </div>
    </>
  );
}
