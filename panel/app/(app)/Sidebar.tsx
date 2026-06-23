"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ORG_NAV, PROJECT_NAV } from "../../lib/nav";
import type { Org } from "../../lib/api";
import { Icon, ShieldMark } from "../icons";
import { logoutAction } from "./actions";
import { OrgSwitcher } from "./OrgSwitcher";
import { ThemeToggle } from "../../components/ThemeToggle";

function projectFromPath(path: string): { name: string; section: string } | null {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "project" && parts[1]) {
    return { name: decodeURIComponent(parts[1]), section: parts[2] ?? "" };
  }
  return null;
}

export function Sidebar({
  email,
  orgs,
  currentOrg,
}: {
  email: string;
  orgs: Org[];
  currentOrg: Org | null;
}) {
  const path = usePathname();
  const initial = (email[0] || "?").toUpperCase();
  const project = projectFromPath(path);

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <Link href="/" className="brand brand-sm">
            <ShieldMark />
            <span className="brand-word">Hauldr</span>
          </Link>
          <ThemeToggle />
        </div>
        <OrgSwitcher orgs={orgs} current={currentOrg} />
      </div>

      <nav className="sidebar-scroll">
        {project ? (
          <ProjectNav name={project.name} section={project.section} />
        ) : (
          <OrgNav path={path} />
        )}
      </nav>

      <div className="sidebar-foot">
        <div className="avatar">{initial}</div>
        <div className="who">
          <b>{email}</b>
          <span>Master</span>
        </div>
        <form action={logoutAction}>
          <button
            className="btn btn-ghost"
            type="submit"
            title="Sign out"
            style={{ padding: "7px 9px" }}
          >
            <Icon name="logout" />
          </button>
        </form>
      </div>
    </aside>
  );
}

function OrgNav({ path }: { path: string }) {
  return (
    <>
      {ORG_NAV.map((group) => (
        <div key={group.label}>
          <div className="nav-group-label">{group.label}</div>
          {group.items.map((item) => {
            const active =
              item.href === "/" ? path === "/" : path.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item${active ? " active" : ""}`}
              >
                <Icon name={item.icon} />
                {item.label}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}

function ProjectNav({ name, section }: { name: string; section: string }) {
  const base = `/project/${encodeURIComponent(name)}`;
  return (
    <>
      <Link href="/projects" className="nav-back">
        <Icon name="back" />
        All projects
      </Link>
      <div className="proj-context">
        <span className="proj-context-glyph">
          <Icon name="overview" />
        </span>
        <span className="proj-context-name" title={name}>
          {name}
        </span>
      </div>

      {PROJECT_NAV.map((group) => (
        <div key={group.label}>
          <div className="nav-group-label">{group.label}</div>
          {group.items.map((item) => {
            const href = item.href ? `${base}/${item.href}` : base;
            const active = section === item.href;
            return (
              <Link
                key={item.label}
                href={href}
                className={`nav-item${active ? " active" : ""}`}
              >
                <Icon name={item.icon} />
                {item.label}
                {!item.ready && <span className="soon">soon</span>}
              </Link>
            );
          })}
        </div>
      ))}
    </>
  );
}
