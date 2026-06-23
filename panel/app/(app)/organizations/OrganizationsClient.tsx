"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Button, Input } from "@cold-code-labs/yggdrasil-react";
import type { Org } from "../../../lib/api";
import { Icon } from "../../icons";
import { setOrgAction } from "../actions";

export function OrganizationsClient({
  initial,
  activeId,
}: {
  initial: Org[];
  activeId: string | null;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const orgs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return initial;
    return initial.filter(
      (o) => o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q),
    );
  }, [initial, query]);

  function enter(id: string) {
    startTransition(() => setOrgAction(id));
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    setError(null);
    const res = await fetch("/api/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: n }),
    });
    const data = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok || !data.id) {
      setError(data.error || "could not create organization");
      return;
    }
    setOpen(false);
    setName("");
    router.refresh();
  }

  return (
    <div className="content">
      <div className="org-toolbar">
        <label className="org-search">
          <Icon name="search" />
          <input
            className="org-search-input"
            placeholder="Search for an organization"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <Button type="button" onClick={() => setOpen(true)}>
          <Icon name="plus" /> New organization
        </Button>
      </div>

      {initial.length === 0 ? (
        <div className="card empty">
          <div className="big">No organizations yet</div>
          <div>Click “New organization” to create your first one.</div>
        </div>
      ) : orgs.length === 0 ? (
        <div className="card empty">
          <div className="big">No matches</div>
          <div>Nothing matches “{query}”.</div>
        </div>
      ) : (
        <div className="org-grid">
          {orgs.map((o) => {
            const active = o.id === activeId;
            const count = o.project_count ?? 0;
            return (
              <button
                key={o.id}
                type="button"
                className={`org-card${active ? " active" : ""}`}
                onClick={() => enter(o.id)}
                disabled={pending}
              >
                <span className="org-card-mark">
                  <Icon name="building" />
                </span>
                <span className="org-card-body">
                  <span className="org-card-name">{o.name}</span>
                  <span className="org-card-meta">
                    {o.is_default && <span className="org-tag">Default</span>}
                    <span>
                      {count} project{count === 1 ? "" : "s"}
                    </span>
                  </span>
                </span>
                {active && <span className="org-card-active">Active</span>}
                <span className="org-card-chev">
                  <Icon name="chevron" />
                </span>
              </button>
            );
          })}
        </div>
      )}

      {open && (
        <div className="modal-scrim" onClick={() => !busy && setOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={create}>
              <div className="modal-head">
                <h3>New organization</h3>
                <button
                  type="button"
                  className="modal-x"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                  aria-label="Close"
                >
                  ✕
                </button>
              </div>

              <div className="field">
                <label className="label" htmlFor="orgname">
                  Organization name
                </label>
                <Input
                  id="orgname"
                  placeholder="e.g. Cold Code Labs"
                  value={name}
                  autoFocus
                  onChange={(e) => setName(e.target.value)}
                  disabled={busy}
                />
                <div className="field-hint">Groups your projects. You can create more later.</div>
              </div>

              {error && <div className="form-error">{error}</div>}

              <div className="modal-foot">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setOpen(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || !name.trim()}>
                  {busy ? "Creating…" : "Create organization"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
