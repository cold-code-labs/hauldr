"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ProjectRow } from "../../lib/api";
import { Icon } from "../icons";

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

export function DashboardClient({ initial }: { initial: ProjectRow[] }) {
  const [projects, setProjects] = useState<ProjectRow[]>(initial ?? []);
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

  const total = projects.length;
  const live = projects.filter((p) => p.status === "live").length;
  const provisioning = projects.filter((p) => p.status === "provisioning").length;
  const issues = projects.filter((p) => p.status === "error").length;
  const authCount = projects.filter((p) => !!p.gotrue_url).length;
  const restCount = projects.filter((p) => !!p.postgrest_url).length;

  return (
    <div className="content">
      <div className="metric-grid">
        <div className="metric">
          <div className="metric-top">
            <span className="metric-ic">
              <Icon name="projects" />
            </span>
            <span className="metric-label">Projects</span>
          </div>
          <div className="metric-value">{total}</div>
          <div className="metric-foot">{live} live</div>
        </div>

        <div className="metric">
          <div className="metric-top">
            <span className="metric-ic ok">
              <Icon name="overview" />
            </span>
            <span className="metric-label">Health</span>
          </div>
          <div className="metric-value">
            {total === 0 ? "—" : issues ? `${total - issues}/${total}` : "All up"}
          </div>
          <div className="metric-foot">
            {issues ? `${issues} need attention` : "no incidents"}
          </div>
        </div>

        <div className="metric">
          <div className="metric-top">
            <span className="metric-ic">
              <Icon name="users" />
            </span>
            <span className="metric-label">Auth (GoTrue)</span>
          </div>
          <div className="metric-value">{authCount}</div>
          <div className="metric-foot">one per project</div>
        </div>

        <div className="metric">
          <div className="metric-top">
            <span className="metric-ic">
              <Icon name="services" />
            </span>
            <span className="metric-label">REST (PostgREST)</span>
          </div>
          <div className="metric-value">{restCount}</div>
          <div className="metric-foot">à-la-carte</div>
        </div>
      </div>

      <div className="section-title">
        <h2>Projects</h2>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          {provisioning > 0 && (
            <span className="badge">
              <span className="spinner" /> {provisioning} provisioning
            </span>
          )}
          <Link href="/projects" className="btn btn-ghost" style={{ padding: "6px 12px" }}>
            View all
          </Link>
        </div>
      </div>

      {total === 0 ? (
        <div className="card empty">
          <div className="big">No projects yet</div>
          <div>
            Create your first one from{" "}
            <Link href="/projects" style={{ color: "var(--cyan-strong)", fontWeight: 600 }}>
              Projects
            </Link>
            .
          </div>
        </div>
      ) : (
        <div className="card health-list">
          {projects.map((p) => {
            const showRest = p.rest_requested || !!p.postgrest_url;
            const liveP = p.status === "live";
            return (
              <Link
                key={p.name}
                href={`/project/${encodeURIComponent(p.name)}`}
                className="health-row"
              >
                <span className="proj-glyph sm">
                  <Icon name="overview" />
                </span>
                <span className="health-main">
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
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
