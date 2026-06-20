import { NextResponse } from "next/server";
import { getSession } from "../../../lib/session";
import { API, authHeaders } from "../../../lib/api";

/** List organizations (with project counts). Session-gated. */
export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const res = await fetch(`${API}/v1/organizations`, { cache: "no-store", headers: authHeaders() });
  return NextResponse.json(await res.json().catch(() => []), { status: res.status });
}

/** Create an organization. Body: { name }. */
export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { name?: string };
  const res = await fetch(`${API}/v1/organizations`, {
    method: "POST",
    headers: authHeaders({ "content-type": "application/json" }),
    body: JSON.stringify({ name: body.name }),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
