"use client";

import { useCallback, useEffect, useState } from "react";

type Row = {
  name: string;
  database: string;
  role?: string;
  status: string;
  status_detail?: string | null;
  gotrue_url?: string | null;
  postgrest_url?: string | null;
  rest_requested?: boolean;
  created_at?: string;
};

type Detail = {
  status: string;
  statusDetail?: string | null;
  services: {
    auth: { url: string; ready: boolean } | null;
    rest: { url: string | null; ready: boolean } | null;
  };
  internal: {
    dbHost: string;
    dbPort: number;
    database: string;
    role: string;
    dbUrl: string;
  } | null;
};

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

export function ProjectsClient({ initial }: { initial: Row[] }) {
  const [projects, setProjects] = useState<Row[]>(initial ?? []);
  const [name, setName] = useState("");
  const [rest, setRest] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [detail, setDetail] = useState<Record<string, Detail>>({});

  const anyProvisioning = projects.some((p) => p.status === "provisioning");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/projects", { cache: "no-store" });
    if (res.ok) setProjects(await res.json());
  }, []);

  // Poll the list while anything is still coming up.
  useEffect(() => {
    if (!anyProvisioning) return;
    const id = setInterval(refresh, 3000);
    return () => clearInterval(id);
  }, [anyProvisioning, refresh]);

  const loadDetail = useCallback(async (n: string) => {
    const res = await fetch(`/api/projects/${n}`, { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as Detail;
      setDetail((d) => ({ ...d, [n]: json }));
    }
  }, []);

  // Keep the open detail fresh as a project transitions provisioning → live.
  useEffect(() => {
    if (expanded) loadDetail(expanded);
  }, [expanded, loadDetail, projects]);

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
    setProjects((ps) => [
      ...ps.filter((p) => p.name !== n),
      {
        name: n,
        database: `db_${n}`,
        status: "provisioning",
        rest_requested: rest,
        gotrue_url: null,
        postgrest_url: null,
      },
    ]);
    setName("");
    setExpanded(n);
  }

  return (
    <div className="content">
      <div className="card card-pad" style={{ marginBottom: 24 }}>
        <form onSubmit={create}>
          <div className="create-row">
            <div className="grow">
              <label className="label" htmlFor="name">
                New project
              </label>
              <input
                id="name"
                className="input"
                placeholder="project name — a-z, 0-9, _"
                pattern="[a-z][a-z0-9_]*"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={creating}
              />
            </div>
            <button className="btn btn-primary" type="submit" disabled={creating || !name.trim()}>
              {creating ? "Starting…" : "Create project"}
            </button>
          </div>

          <div className="create-opts">
            <label className="switch">
              <input
                type="checkbox"
                checked
                disabled
                readOnly
              />
              <span className="track" style={{ opacity: 0.7 }} />
              Auth (GoTrue)
              <span className="hint">always</span>
            </label>
            <label className="switch">
              <input
                type="checkbox"
                checked={rest}
                onChange={(e) => setRest(e.target.checked)}
                disabled={creating}
              />
              <span className="track" />
              REST API (PostgREST)
              <span className="hint">à-la-carte</span>
            </label>
          </div>

          {error && (
            <div className="form-error" style={{ marginTop: 14 }}>
              {error}
            </div>
          )}
        </form>
      </div>

      <div className="section-title">
        <h2>
          {projects.length} project{projects.length === 1 ? "" : "s"}
        </h2>
        {anyProvisioning && (
          <span className="badge">
            <span className="spinner" /> provisioning…
          </span>
        )}
      </div>

      {projects.length === 0 ? (
        <div className="card empty">
          <div className="big">No projects yet</div>
          <div>Provision your first database above.</div>
        </div>
      ) : (
        <div className="card">
          {projects.map((p) => {
            const live = p.status === "live";
            const isErr = p.status === "error";
            const showRest = p.rest_requested || !!p.postgrest_url;
            const d = detail[p.name];
            const open = expanded === p.name;
            return (
              <div className="pcard" key={p.name}>
                <div
                  className="pcard-head"
                  onClick={() => setExpanded(open ? null : p.name)}
                >
                  <div className="proj-glyph">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6">
                      <ellipse cx="12" cy="6" rx="7" ry="2.6" />
                      <path d="M5 6v12c0 1.5 3.1 2.6 7 2.6s7-1.1 7-2.6V6M5 12c0 1.5 3.1 2.6 7 2.6s7-1.1 7-2.6" />
                    </svg>
                  </div>
                  <div className="pcard-main">
                    <div className="name">{p.name}</div>
                    <div className="meta mono">{p.database}</div>
                  </div>
                  <div className="pcard-chips">
                    <span className={`chip ${live ? "ready" : "pending"}`}>
                      <span className="cdot" />
                      Auth
                    </span>
                    {showRest && (
                      <span className={`chip ${live && p.postgrest_url ? "ready" : "pending"}`}>
                        <span className="cdot" />
                        REST
                      </span>
                    )}
                    <StatusBadge status={p.status} />
                  </div>
                </div>

                {open && (
                  <div className="pcard-detail">
                    {isErr ? (
                      <div className="detail-err">
                        Provisioning failed: {p.status_detail || d?.statusDetail || "unknown error"}
                      </div>
                    ) : (
                      <>
                        {d?.services?.auth?.url && (
                          <div className="endpoint">
                            <span className="ekey">Auth</span>
                            <div className="copyfield">
                              <code>{d.services.auth.url}</code>
                              <Copy value={d.services.auth.url} />
                            </div>
                          </div>
                        )}
                        {d?.services?.rest?.url && (
                          <div className="endpoint">
                            <span className="ekey">REST</span>
                            <div className="copyfield">
                              <code>{d.services.rest.url}</code>
                              <Copy value={d.services.rest.url} />
                            </div>
                          </div>
                        )}
                        {d?.internal?.dbUrl && (
                          <div className="endpoint">
                            <span className="ekey">Internal DB</span>
                            <div className="copyfield">
                              <code>{d.internal.dbUrl}</code>
                              <Copy value={d.internal.dbUrl} />
                            </div>
                          </div>
                        )}
                        <div className="detail-note">
                          {live ? (
                            <>
                              <b>Internal-first:</b> apps on this server reach the database at{" "}
                              <b>{d?.internal?.dbHost ?? "hauldr-db"}:{d?.internal?.dbPort ?? 5432}</b> over the
                              private network — no public DB route.
                            </>
                          ) : (
                            <>Bringing up the sidecars… this card updates itself.</>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
