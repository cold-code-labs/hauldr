import { createProjectAction } from "./actions";

const API = process.env.HAULDR_API_URL || "http://localhost:8787";
const KEY = process.env.HAULDR_API_KEY || "";

type Project = {
  name: string;
  database: string;
  role: string;
  created_at: string;
};

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  let projects: Project[] = [];
  let error: string | null = null;
  try {
    const res = await fetch(`${API}/v1/projects`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${KEY}` },
    });
    projects = await res.json();
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

      <div className="content">
        <div className="card card-pad" style={{ marginBottom: 24 }}>
          <form
            action={createProjectAction}
            style={{ display: "flex", gap: 10, alignItems: "flex-end" }}
          >
            <div style={{ flex: 1 }}>
              <label className="label" htmlFor="name">
                New project
              </label>
              <input
                id="name"
                name="name"
                className="input"
                placeholder="project name — a-z, 0-9, _"
                pattern="[a-z][a-z0-9_]*"
              />
            </div>
            <button className="btn btn-primary" type="submit">
              Create project
            </button>
          </form>
        </div>

        <div className="section-title">
          <h2>{projects.length} project{projects.length === 1 ? "" : "s"}</h2>
        </div>

        {error ? (
          <div className="card card-pad form-error" style={{ margin: 0 }}>
            Control plane unreachable: {error}
          </div>
        ) : projects.length === 0 ? (
          <div className="card empty">
            <div className="big">No projects yet</div>
            <div>Provision your first database above.</div>
          </div>
        ) : (
          <div className="card">
            {projects.map((p) => (
              <div className="proj" key={p.name}>
                <div className="proj-glyph">
                  <svg
                    viewBox="0 0 24 24"
                    width="18"
                    height="18"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.6"
                  >
                    <ellipse cx="12" cy="6" rx="7" ry="2.6" />
                    <path d="M5 6v12c0 1.5 3.1 2.6 7 2.6s7-1.1 7-2.6V6M5 12c0 1.5 3.1 2.6 7 2.6s7-1.1 7-2.6" />
                  </svg>
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="name">{p.name}</div>
                  <div className="meta mono">{p.database}</div>
                </div>
                <span className="badge">
                  {p.created_at
                    ? new Date(p.created_at).toLocaleDateString()
                    : "—"}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
