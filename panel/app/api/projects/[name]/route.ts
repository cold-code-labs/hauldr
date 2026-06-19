import { NextResponse } from "next/server";
import { getSession } from "../../../../lib/session";

const API = process.env.HAULDR_API_URL || "http://localhost:8787";
const KEY = process.env.HAULDR_API_KEY || "";

type Ctx = { params: Promise<{ name: string }> };

/** Project detail: live sidecar health + the internal connection block. */
export async function GET(_req: Request, { params }: Ctx) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { name } = await params;
  const res = await fetch(`${API}/v1/projects/${encodeURIComponent(name)}`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${KEY}` },
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}

/** Tear down a project and all its satellites. */
export async function DELETE(_req: Request, { params }: Ctx) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { name } = await params;
  const res = await fetch(`${API}/v1/projects/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${KEY}` },
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
