"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { EmptyState, Stat, StatStrip } from "@cold-code-labs/yggdrasil-react";
import type { ProjectRow } from "../../lib/api";
import { Icon } from "../icons";
import { StatusBadge } from "../../components/StatusBadge";

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
      <StatStrip>
        <Stat value={total} label={`Projects · ${live} live`} dot tone="info" />
        <Stat
          value={total === 0 ? "—" : issues ? `${total - issues}/${total}` : "All up"}
          label={issues ? `Health · ${issues} need attention` : "Health · no incidents"}
          dot
          tone={issues ? "err" : "ok"}
        />
        <Stat value={authCount} label="Auth (GoTrue) · one per project" dot tone="info" />
        <Stat value={restCount} label="REST (PostgREST) · à-la-carte" dot tone="info" />
      </StatStrip>

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
        <EmptyState
          title="No projects yet"
          description="Create your first one from Projects."
          action={
            <Link href="/projects" className="btn btn-primary">
              Go to Projects
            </Link>
          }
        />
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
