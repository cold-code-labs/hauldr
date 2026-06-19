import { NextResponse } from "next/server";
import { getSession } from "../../../lib/session";

const API = process.env.HAULDR_API_URL || "http://localhost:8787";
const KEY = process.env.HAULDR_API_KEY || "";

/** List projects (status + sidecar urls). Session-gated — the panel is public. */
export async function GET() {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const res = await fetch(`${API}/v1/projects`, {
    cache: "no-store",
    headers: { authorization: `Bearer ${KEY}` },
  });
  return NextResponse.json(await res.json().catch(() => []), { status: res.status });
}

/** Provision a new project (async). Body: { name, rest? }. */
export async function POST(req: Request) {
  if (!(await getSession())) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { name?: string; rest?: boolean };
  const res = await fetch(`${API}/v1/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
    body: JSON.stringify({ name: body.name, rest: !!body.rest }),
  });
  return NextResponse.json(await res.json().catch(() => ({})), { status: res.status });
}
