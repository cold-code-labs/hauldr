"use client";

import { useCallback, useEffect, useState } from "react";
import type { ProjectDetail } from "../../../../../lib/api";
import { Icon } from "../../../../icons";

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

export function ServicesClient({
  name,
  initial,
}: {
  name: string;
  initial: ProjectDetail;
}) {
  const [d, setD] = useState<ProjectDetail>(initial);
  const [busy, setBusy] = useState<null | "enabling" | "disabling">(null);
  const [error, setError] = useState<string | null>(null);

  const auth = d.services.auth;
  const rest = d.services.rest;
  const restEnabled = !!rest?.url;
  const restPending = busy === "enabling" || (restEnabled && !rest?.ready);

  const refresh = useCallback(async () => {
    const res = await fetch(`/api/projects/${encodeURIComponent(name)}`, { cache: "no-store" });
    if (res.ok) setD(await res.json());
  }, [name]);

  // Poll while a sidecar is mid-transition (coming up or being requested).
  useEffect(() => {
    if (!busy && !(restEnabled && !rest?.ready)) return;
    const id = setInterval(refresh, 2500);
    return () => clearInterval(id);
  }, [busy, restEnabled, rest?.ready, refresh]);

  // Once the REST sidecar is actually ready, clear the "enabling" state.
  useEffect(() => {
    if (busy === "enabling" && restEnabled && rest?.ready) setBusy(null);
  }, [busy, restEnabled, rest?.ready]);

  async function enableRest() {
    setBusy("enabling");
    setError(null);
    const res = await fetch(`/api/projects/${encodeURIComponent(name)}/services/rest`, {
      method: "POST",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "could not enable REST");
      setBusy(null);
    }
    await refresh();
  }

  async function disableRest() {
    setBusy("disabling");
    setError(null);
    const res = await fetch(`/api/projects/${encodeURIComponent(name)}/services/rest`, {
      method: "DELETE",
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error || "could not disable REST");
    }
    await refresh();
    setBusy(null);
  }

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Services</h1>
          <div className="sub mono">{name}</div>
        </div>
        <span className="badge ok">
          <span className="dot" /> {d.status === "live" ? "Live" : d.status}
        </span>
      </header>

      <div className="content">
        <div className="section-title">
          <h2>Sidecars</h2>
        </div>

        <div className="card svc-cards">
          {/* Auth — always on, never a toggle. */}
          <div className="svc-card">
            <span className="svc-card-ic ok">
              <Icon name="users" />
            </span>
            <div className="svc-card-body">
              <div className="svc-card-head">
                <span className="svc-card-name">Auth (GoTrue)</span>
                <span className="chip ready">
                  <span className="cdot" /> {auth?.ready ? "Running" : "Up"}
                </span>
              </div>
              <div className="svc-card-sub">
                Every project’s authentication — JWT-based, RLS-aware. On by design.
              </div>
              {auth?.url && (
                <div className="copyfield" style={{ marginTop: 10 }}>
                  <code>{auth.url}</code>
                  <Copy value={auth.url} />
                </div>
              )}
            </div>
            <span className="svc-locked-tag">
              <Icon name="check" /> Always on
            </span>
          </div>

          {/* REST — à-la-carte: enable / disable anytime. */}
          <div className="svc-card">
            <span className={`svc-card-ic${restEnabled ? " ok" : ""}`}>
              <Icon name="services" />
            </span>
            <div className="svc-card-body">
              <div className="svc-card-head">
                <span className="svc-card-name">REST API (PostgREST)</span>
                {restEnabled ? (
                  <span className={`chip ${rest?.ready ? "ready" : "pending"}`}>
                    <span className="cdot" /> {rest?.ready ? "Running" : "Coming up"}
                  </span>
                ) : (
                  <span className="chip">
                    <span className="cdot" /> Off
                  </span>
                )}
              </div>
              <div className="svc-card-sub">
                A raw REST surface over your data, enforcing the same RLS. Reuses this
                project’s authenticator and GoTrue token — add or remove it anytime.
              </div>
              {restEnabled && rest?.url && (
                <div className="copyfield" style={{ marginTop: 10 }}>
                  <code>{rest.url}</code>
                  <Copy value={rest.url} />
                </div>
              )}
            </div>
            <div className="svc-action">
              {restEnabled ? (
                <button
                  className="btn btn-danger-ghost"
                  onClick={disableRest}
                  disabled={busy !== null}
                >
                  {busy === "disabling" ? "Disabling…" : "Disable"}
                </button>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={enableRest}
                  disabled={busy !== null}
                >
                  {restPending ? (
                    <>
                      <span className="spinner" /> Enabling…
                    </>
                  ) : (
                    <>
                      <Icon name="power" /> Enable
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
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
