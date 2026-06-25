import type { FleetJob } from "./types";
import { config } from "../config";

/**
 * brokk-access — keep the review bot (brokk-ccl) at `push` on every active repo
 * in the org, so a newly created project needs ZERO manual steps before brokk
 * can open PRs. An idempotent reconciler: each run lists the org's repos and
 * grants any that are below target. Re-running once everything is in sync is a
 * no-op.
 *
 * Why a reconciler (not a webhook): brokk authenticates as a USER via a PAT, so
 * the GitHub-App "all repos" auto-access isn't available. A periodic sweep is
 * the zero-hosting way to keep new repos covered.
 */

const API = "https://api.github.com";

// Effective-permission strings (GET …/permission) → comparable rank. PUT uses
// the verb form (pull/triage/push/maintain/admin); both map to the same scale.
const RANK: Record<string, number> = {
  none: 0,
  read: 1,
  pull: 1,
  triage: 2,
  write: 3,
  push: 3,
  maintain: 4,
  admin: 5,
};

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.github.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "hauldr-fleet-worker",
  };
}

type Repo = { name: string; archived: boolean };

async function listOrgRepos(): Promise<Repo[]> {
  const { org } = config.github;
  const out: Repo[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(
      `${API}/orgs/${org}/repos?per_page=100&type=all&sort=created&page=${page}`,
      { headers: headers() },
    );
    if (!res.ok) {
      throw new Error(`list repos failed: ${res.status} ${await res.text()}`);
    }
    const batch = (await res.json()) as Repo[];
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

/** brokk's current effective rank on a repo, or -1 if it can't be read. */
async function currentRank(repo: string): Promise<number> {
  const { org, bot } = config.github;
  const res = await fetch(
    `${API}/repos/${org}/${repo}/collaborators/${bot}/permission`,
    { headers: headers() },
  );
  if (!res.ok) return -1; // unknown → treat as "needs grant"
  const body = (await res.json()) as { permission?: string; role_name?: string };
  const level = (body.role_name || body.permission || "none").toLowerCase();
  return RANK[level] ?? 0;
}

async function grant(repo: string): Promise<"granted" | "invited"> {
  const { org, bot, permission } = config.github;
  const res = await fetch(`${API}/repos/${org}/${repo}/collaborators/${bot}`, {
    method: "PUT",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ permission }),
  });
  // 204: already a collaborator / org member → direct grant or update.
  // 201: an outside-collaborator invitation was created (pending accept).
  if (res.status === 204) return "granted";
  if (res.status === 201) return "invited";
  throw new Error(`grant ${repo} failed: ${res.status} ${await res.text()}`);
}

async function run(): Promise<void> {
  const gh = config.github;
  if (!gh.token) {
    console.log("[brokk-access] not configured (GH_ADMIN_TOKEN) — skipping");
    return;
  }

  const target = RANK[gh.permission] ?? RANK.push;
  const all = await listOrgRepos();

  let repos = all.filter((r) => gh.includeArchived || !r.archived);
  if (gh.allowlist.length) {
    repos = repos.filter((r) => gh.allowlist.includes(r.name));
  } else if (gh.denylist.length) {
    repos = repos.filter((r) => !gh.denylist.includes(r.name));
  }

  let ok = 0;
  let changed = 0;
  let errors = 0;
  for (const repo of repos) {
    try {
      if ((await currentRank(repo.name)) >= target) {
        ok++;
        continue;
      }
      changed++;
      if (gh.dryRun) {
        console.log(`[brokk-access] would grant: ${repo.name} → ${gh.permission}`);
        continue;
      }
      const result = await grant(repo.name);
      console.log(`[brokk-access] ${result}: ${repo.name} → ${gh.permission}`);
    } catch (e) {
      // A single un-adminable repo shouldn't fail the whole reconcile — log it
      // and keep going; the run stays green so the cron isn't perpetually red.
      errors++;
      console.error(`[brokk-access] ${repo.name}: ${(e as Error).message}`);
    }
  }

  console.log(
    `[brokk-access] ${gh.bot}@${gh.org}: ${repos.length} repos · ` +
      `${ok} ok · ${changed} ${gh.dryRun ? "would-grant" : "granted"} · ${errors} errors` +
      (gh.denylist.length ? ` · denylist:${gh.denylist.length}` : "") +
      (gh.allowlist.length ? ` · allowlist:${gh.allowlist.length}` : "") +
      (gh.dryRun ? " · DRY-RUN" : ""),
  );
}

export const brokkAccess: FleetJob = {
  name: "brokk-access-reconcile",
  cron: config.github.cron,
  run,
};
