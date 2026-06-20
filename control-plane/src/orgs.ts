import { controlPool } from "./db";
import { config } from "./config";
import { ensureMaster } from "./zero";

/**
 * Organizations — the grouping above projects. There is always at least one (the
 * default, created at first-run / by the bootstrap); operators may create more.
 * "Initialized" means a default organization exists: until then the panel shows
 * the first-run wizard instead of the login screen.
 */

export type Organization = {
  id: string;
  name: string;
  slug: string;
  is_default: boolean;
  created_at: string;
  project_count?: number;
};

const SLUG_MAX = 48;

function baseSlug(name: string): string {
  const s = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-+|-+$)/g, "")
    .slice(0, SLUG_MAX);
  return s || "org";
}

/** A unique slug derived from the name, suffixing -2, -3… on collision. */
async function uniqueSlug(name: string): Promise<string> {
  const base = baseSlug(name);
  for (let i = 1; i < 1000; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    const { rowCount } = await controlPool.query(
      "select 1 from organizations where slug = $1",
      [slug],
    );
    if (!rowCount) return slug;
  }
  throw new Error(`could not derive a unique slug for '${name}'`);
}

/** List organizations with their project counts (for the switcher + dashboard). */
export async function listOrganizations(): Promise<Organization[]> {
  const { rows } = await controlPool.query(
    `select o.id, o.name, o.slug, o.is_default, o.created_at,
            count(p.name)::int as project_count
       from organizations o
       left join projects p on p.organization_id = o.id
      group by o.id
      order by o.is_default desc, o.created_at`,
  );
  return rows as Organization[];
}

/** The default (tenant-zero) organization, or null if the system is uninitialized. */
export async function defaultOrganization(): Promise<Organization | null> {
  const { rows } = await controlPool.query(
    "select id, name, slug, is_default, created_at from organizations where is_default order by created_at limit 1",
  );
  return (rows[0] as Organization) ?? null;
}

/** The id a new project lands in when none is specified — the default org. */
export async function defaultOrgId(): Promise<string | null> {
  const org = await defaultOrganization();
  return org?.id ?? null;
}

/** Create an organization. The first one ever created becomes the default. */
export async function createOrganization(
  name: string,
  opts: { isDefault?: boolean } = {},
): Promise<Organization> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("organization name is required");

  const existing = await controlPool.query("select count(*)::int as n from organizations");
  const isFirst = existing.rows[0].n === 0;
  const isDefault = opts.isDefault ?? isFirst;
  const slug = await uniqueSlug(trimmed);

  const { rows } = await controlPool.query(
    `insert into organizations (name, slug, is_default)
       values ($1, $2, $3)
     returning id, name, slug, is_default, created_at`,
    [trimmed, slug, isDefault],
  );
  return rows[0] as Organization;
}

/** Ensure a default organization exists (idempotent) — used by the bootstrap. */
export async function ensureDefaultOrganization(name: string): Promise<Organization> {
  const existing = await defaultOrganization();
  if (existing) return existing;
  return createOrganization(name, { isDefault: true });
}

/** Adopt any project without an organization into the given org. Returns the count. */
export async function adoptOrphanProjects(orgId: string): Promise<number> {
  const { rowCount } = await controlPool.query(
    "update projects set organization_id = $1 where organization_id is null",
    [orgId],
  );
  return rowCount ?? 0;
}

/**
 * Whether the install has been set up: a default organization exists. The panel
 * reads this to choose between the first-run wizard and the login screen.
 */
export async function systemStatus(): Promise<{
  initialized: boolean;
  orgCount: number;
  defaultOrg: Organization | null;
  masterEmail: string | null;
}> {
  const { rows } = await controlPool.query("select count(*)::int as n from organizations");
  const orgCount = rows[0].n as number;
  const defaultOrg = orgCount ? await defaultOrganization() : null;
  return {
    initialized: orgCount > 0,
    orgCount,
    defaultOrg,
    masterEmail: config.masterEmail || null,
  };
}

/**
 * First-run setup: create the master operator (in project-zero GoTrue) and the
 * default organization (tenant zero). Refuses to run once initialized so the
 * endpoint can't be used to mint extra masters. Master first, so a failure there
 * leaves the system uninitialized and the wizard can be retried cleanly.
 */
export async function initSystem(input: {
  email: string;
  password: string;
  orgName: string;
}): Promise<{ org: Organization }> {
  const email = input.email.trim().toLowerCase();
  const orgName = input.orgName.trim();
  if (!email || !input.password) throw new Error("email and password are required");
  if (!orgName) throw new Error("organization name is required");

  if ((await defaultOrganization()) !== null) {
    throw new Error("already initialized");
  }

  await ensureMaster(email, input.password);
  const org = await ensureDefaultOrganization(orgName);
  return { org };
}
