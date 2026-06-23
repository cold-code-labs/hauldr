"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Button, EmptyState, Input } from "@cold-code-labs/yggdrasil-react";
import type { ProjectRow } from "../../../lib/api";
import { Icon } from "../../icons";
import { StatusBadge } from "../../../components/StatusBadge";

export function ProjectsList({
  initial,
  orgName,
}: {
  initial: ProjectRow[];
  orgName: string;
}) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectRow[]>(initial ?? []);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [rest, setRest] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const anyProvisioning = projects.some((p) => p.status === "provisioning");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/projects", { cache: "no-store" });
    if (res.ok) setProjects(await res.json());
  }, []);

  useEffect(() => {
    if (!anyProvisioning) return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [anyProvisioning, refresh]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setCreating(true);
    setError(null);
    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: n, rest }),
    });
    const data = await res.json().catch(() => ({}));
    setCreating(false);
    if (!res.ok) {
      setError(data.error || "failed to create project");
      return;
    }
    setOpen(false);
    setName("");
    setRest(false);
    // Land on the new project so the operator can watch it come up.
    router.push(`/project/${encodeURIComponent(n)}`);
  }

  return (
    <div className="content">
      <div className="section-title">
        <h2>
          {projects.length} project{projects.length === 1 ? "" : "s"} in {orgName}
        </h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {anyProvisioning && (
            <span className="badge">
              <span className="spinner" /> provisioning…
            </span>
          )}
          <Button type="button" onClick={() => setOpen(true)}>
            <Icon name="plus" /> New project
          </Button>
        </div>
      </div>

      {projects.length === 0 ? (
        <EmptyState
          title="No projects yet"
          description="Click “New project” to provision your first database."
          action={
            <Button type="button" onClick={() => setOpen(true)}>
              <Icon name="plus" /> New project
            </Button>
          }
        />
      ) : (
        <div className="card">
          {projects.map((p) => {
            const showRest = p.rest_requested || !!p.postgrest_url;
            const liveP = p.status === "live";
            return (
              <Link
                key={p.name}
                href={`/project/${encodeURIComponent(p.name)}`}
                className="proj proj-link"
              >
                <span className="proj-glyph">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <ellipse cx="12" cy="6" rx="7" ry="2.6" />
                    <path d="M5 6v12c0 1.5 3.1 2.6 7 2.6s7-1.1 7-2.6V6M5 12c0 1.5 3.1 2.6 7 2.6s7-1.1 7-2.6" />
                  </svg>
                </span>
                <span className="proj-main">
                  <span className="name">{p.name}</span>
                  <span className="meta mono">{p.database}</span>
                </span>
                <span className="pcard-chips">
                  <span className={`chip ${liveP && p.gotrue_url ? "ready" : "pending"}`}>
                    <span className="cdot" /> Auth
                  </span>
                  {showRest && (
                    <span className={`chip ${liveP && p.postgrest_url ? "ready" : "pending"}`}>
                      <span className="cdot" /> REST
                    </span>
                  )}
                  <StatusBadge status={p.status} />
                  <span className="proj-chev">
                    <Icon name="chevron" />
                  </span>
                </span>
              </Link>
            );
          })}
        </div>
      )}

      {open && (
        <div className="modal-scrim" onClick={() => !creating && setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={create}>
              <div className="modal-head">
                <h3>New project</h3>
                <button
                  type="button"
                  className="modal-x"
                  onClick={() => setOpen(false)}
                  disabled={creating}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="field">
                <label className="label" htmlFor="pname">
                  Project name
                </label>
                <Input
                  id="pname"
                  placeholder="project name — a-z, 0-9, _"
                  pattern="[a-z][a-z0-9_]*"
                  value={name}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                  disabled={creating}
                />
                <div className="field-hint">
                  Becomes its database <code className="mono">db_{name || "name"}</code>.
                </div>
              </div>

              <div className="modal-services">
                <div className="svc-line">
                  <span className="svc-info">
                    <span className="svc-name">Auth (GoTrue)</span>
                    <span className="svc-sub">Every project gets its own — by design.</span>
                  </span>
                  <span className="svc-locked">
                    <Icon name="check" /> Always on
                  </span>
                </div>
                <label className="svc-line svc-toggle">
                  <span className="svc-info">
                    <span className="svc-name">REST API (PostgREST)</span>
                    <span className="svc-sub">Raw REST over your data. Add or remove anytime.</span>
                  </span>
                  <span className="switch">
                    <input
                      type="checkbox"
                      checked={rest}
                      onChange={(e) => setRest(e.target.checked)}
                      disabled={creating}
                    />
                    <span className="track" />
                  </span>
                </label>
              </div>

              {error && <div className="form-error">{error}</div>}

              <div className="modal-foot">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  disabled={creating}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={creating || !name.trim()}>
                  {creating ? "Starting…" : "Create project"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
