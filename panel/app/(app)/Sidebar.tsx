"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "../../lib/nav";
import { Icon, ShieldMark } from "../icons";
import { logoutAction } from "./actions";

export function Sidebar({ email }: { email: string }) {
  const path = usePathname();
  const initial = (email[0] || "?").toUpperCase();

  return (
    <aside className="sidebar">
      <div className="sidebar-head">
        <Link href="/" className="brand">
          <ShieldMark />
          <span className="brand-word">Hauldr</span>
        </Link>
      </div>

      <nav className="sidebar-scroll">
        {NAV.map((group) => (
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
                  {!item.ready && <span className="soon">soon</span>}
                </Link>
              );
            })}
          </div>
        ))}
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
