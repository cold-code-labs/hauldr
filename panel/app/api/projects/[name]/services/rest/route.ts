import { NextResponse } from "next/server";
import { getSession } from "../../../../../../lib/session";
import { API, authHeaders } from "../../../../../../lib/api";

type Ctx = { params: Promise<{ name: string }> };

/** Enable the à-la-carte PostgREST layer for a project. */
export async function POST(_req: Request, { params }: Ctx) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { name } = await params;
  const res = await fetch(`${API}/v1/projects/${encodeURIComponent(name)}/services/rest`, {
    method: "POST",
    headers: authHeaders(),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

/** Disable (tear down) a project's PostgREST. */
export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { name } = await params;
  const res = await fetch(`${API}/v1/projects/${encodeURIComponent(name)}/services/rest`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
