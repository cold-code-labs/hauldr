// Server-side client for the Hauldr control-plane management API. The bearer key
// lives only on the panel server; the browser never sees it. Every call is
// no-store — the control plane is the source of truth for live state.

const API = process.env.HAULDR_API_URL || "http://localhost:8787";
const KEY = process.env.HAULDR_API_KEY || "";

function authHeaders(extra?: Record<string, string>) {
  return { authorization: `Bearer ${KEY}`, ...extra };
}

export type Org = {
  id: string;
  name: string;
  slug: string;
  is_default: boolean;
  created_at: string;
  project_count?: number;
};

export type SystemStatus = {
  initialized: boolean;
  orgCount: number;
  defaultOrg: Org | null;
  masterEmail: string | null;
  reachable: boolean;
};

export type ProjectRow = {
  name: string;
  database: string;
  role?: string;
  status: string;
  status_detail?: string | null;
  gotrue_url?: string | null;
  postgrest_url?: string | null;
  rest_requested?: boolean;
  organization_id?: string | null;
  created_at?: string;
};

export type ProjectDetail = {
  name: string;
  database: string;
  role: string;
  status: string;
  statusDetail?: string | null;
  createdAt?: string;
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

const UNREACHABLE: SystemStatus = {
  initialized: false,
  orgCount: 0,
  defaultOrg: null,
  masterEmail: null,
  reachable: false,
};

/** First-run / setup status. `reachable: false` means the control plane is down —
 *  callers should surface that rather than treat it as "uninitialized". */
export async function getSystem(): Promise<SystemStatus> {
  try {
    const res = await fetch(`${API}/v1/system`, { cache: "no-store", headers: authHeaders() });
    if (!res.ok) return UNREACHABLE;
    const s = (await res.json()) as Omit<SystemStatus, "reachable">;
    return { ...s, reachable: true };
  } catch {
    return UNREACHABLE;
  }
}

export async function listOrganizations(): Promise<Org[]> {
  try {
    const res = await fetch(`${API}/v1/organizations`, { cache: "no-store", headers: authHeaders() });
    const json = await res.json();
    return Array.isArray(json) ? (json as Org[]) : [];
  } catch {
    return [];
  }
}

export async function listProjects(orgId?: string | null): Promise<ProjectRow[]> {
  const qs = orgId ? `?org=${encodeURIComponent(orgId)}` : "";
  try {
    const res = await fetch(`${API}/v1/projects${qs}`, { cache: "no-store", headers: authHeaders() });
    const json = await res.json();
    return Array.isArray(json) ? (json as ProjectRow[]) : [];
  } catch {
    return [];
  }
}

export async function getProject(name: string): Promise<ProjectDetail | null> {
  try {
    const res = await fetch(`${API}/v1/projects/${encodeURIComponent(name)}`, {
      cache: "no-store",
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    return (await res.json()) as ProjectDetail;
  } catch {
    return null;
  }
}

/** First-run setup: create the master operator + the default organization. */
export async function initSystem(input: {
  email: string;
  password: string;
  orgName: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API}/v1/system/init`, {
      method: "POST",
      headers: authHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(input),
    });
    if (res.ok) return { ok: true };
    const body = await res.json().catch(() => ({}));
    return { ok: false, error: body.error || "setup failed" };
  } catch {
    return { ok: false, error: "control plane unreachable" };
  }
}

export { API, KEY, authHeaders };
