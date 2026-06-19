import { ProjectsClient } from "./ProjectsClient";

const API = process.env.HAULDR_API_URL || "http://localhost:8787";
const KEY = process.env.HAULDR_API_KEY || "";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  let projects: any[] = [];
  let error: string | null = null;
  try {
    const res = await fetch(`${API}/v1/projects`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${KEY}` },
    });
    projects = await res.json();
    if (!Array.isArray(projects)) projects = [];
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <>
      <header className="topbar">
        <div>
          <h1>Projects</h1>
          <div className="sub">
            Each project is an isolated Postgres database with its own auth.
          </div>
        </div>
        <span className="badge ok">
          <span className="dot" /> Control plane online
        </span>
      </header>

      {error ? (
        <div className="content">
          <div className="card card-pad form-error" style={{ margin: 0 }}>
            Control plane unreachable: {error}
          </div>
        </div>
      ) : (
        <ProjectsClient initial={projects} />
      )}
    </>
  );
}
