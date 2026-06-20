"use client";

import { useState, useTransition } from "react";
import type { Org } from "../../lib/api";
import { Icon } from "../icons";
import { setOrgAction } from "./actions";

export function OrgSwitcher({ orgs, current }: { orgs: Org[]; current: Org | null }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function pick(id: string) {
    if (id === current?.id) return setOpen(false);
    startTransition(() => setOrgAction(id));
  }

  async function create() {
    const name = newName.trim();
    if (!name) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !data.id) {
      setError(data.error || "could not create");
      return;
    }
    startTransition(() => setOrgAction(data.id));
  }

  return (
    <div className="orgsw">
      <button
        type="button"
        className="orgsw-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="orgsw-mark">
          <Icon name="building" />
        </span>
        <span className="orgsw-name">{current?.name ?? "No organization"}</span>
        <span className="orgsw-chev">
          <Icon name="chevron" />
        </span>
      </button>

      {open && (
        <>
          <div className="orgsw-scrim" onClick={() => setOpen(false)} />
          <div className="orgsw-menu" role="menu">
            <div className="orgsw-menu-label">Organizations</div>
            {orgs.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`orgsw-item${o.id === current?.id ? " active" : ""}`}
                onClick={() => pick(o.id)}
              >
                <span className="orgsw-item-name">{o.name}</span>
                {typeof o.project_count === "number" && (
                  <span className="orgsw-count">{o.project_count}</span>
                )}
                {o.id === current?.id && (
                  <span className="orgsw-check">
                    <Icon name="check" />
                  </span>
                )}
              </button>
            ))}

            <div className="orgsw-sep" />
            {creating ? (
              <div className="orgsw-create">
                <input
                  className="input"
                  placeholder="Organization name"
                  value={newName}
                  autoFocus
                  disabled={busy}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") create();
                    if (e.key === "Escape") setCreating(false);
                  }}
                />
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={create}
                  disabled={busy || !newName.trim()}
                >
                  {busy ? "…" : "Add"}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="orgsw-item orgsw-new"
                onClick={() => setCreating(true)}
              >
                <span className="orgsw-plus">
                  <Icon name="plus" />
                </span>
                New organization
              </button>
            )}
            {error && <div className="orgsw-err">{error}</div>}
          </div>
        </>
      )}
    </div>
  );
}
