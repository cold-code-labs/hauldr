import crypto from "node:crypto";
import { adminClient, dbClient, controlPool } from "./db";
import { applyMigrations } from "./migrate";
import { ensureGlobalRoles } from "./roles";
import { projectMigrationsDir } from "./paths";
import { config } from "./config";
import {
  poolerEnabled,
  registerTenant,
  deregisterTenant,
  poolerConnectionString,
} from "./supavisor";
import { provisionAuth, destroyAuth, type ProjectAuth } from "./gotrue";
import { destroyRest } from "./postgrest";
import { destroyRealtime } from "./realtime";
import { destroyStorageApi } from "./storageapi";
import {
  storageEnabled,
  provisionStorage,
  destroyStorage,
  type ProjectStorage,
} from "./storage";
import { defaultOrgId } from "./orgs";

const SLUG = /^[a-z][a-z0-9_]{1,40}$/;

export type Project = {
  name: string;
  database: string;
  role: string;
  applied: string[];
  connectionString: string;
  pooled: boolean;
};

export type FullProject = Project & {
  auth: ProjectAuth | null;
  storage: ProjectStorage | null;
};

/**
 * The full createProject flow: a database + its auth. This is what the
 * management API and CLI expose — a brand-new application's complete backend.
 * Auth is always provisioned unless the operator opts out (authProvisioner
 * = "none"), in which case it is a pure data plane (e.g. for tests).
 */
export async function createProject(name: string): Promise<FullProject> {
  const dp = await provisionDatabase(name);
  const auth =
    config.authProvisioner === "none" ? null : await provisionAuth(name);
  const storage = storageEnabled() ? await provisionStorage(name) : null;
  return { ...dp, auth, storage };
}

/**
 * Provision a project's data plane:
 *  - a dedicated authenticator login role (NOINHERIT; member of anon/authenticated)
 *  - a dedicated database (owned by postgres; only this project's role connects)
 *  - the base schema applied (tables owned by postgres → RLS applies to the app)
 *  - a Supavisor tenant routing the project (transaction mode, for RLS data)
 *  - a row in the control registry
 * Idempotent on role / database / tenant. Auth (a per-project GoTrue) is layered
 * on top by provisionAuth — the data plane is auth-agnostic: RLS keys off the
 * `sub` claim, which is exactly what a GoTrue token carries.
 */
export async function provisionDatabase(name: string): Promise<Project> {
  if (!SLUG.test(name)) {
    throw new Error(
      `invalid project name '${name}' (a-z, 0-9, _, must start with a letter)`,
    );
  }

  const database = `db_${name}`;
  const role = `${name}_authenticator`; // the authenticator (login) role
  const externalId = name; // Supavisor tenant id

  // Reuse a stored password if the project already exists, so re-provisioning is
  // idempotent and the tenant can be re-registered with the same credentials.
  const prev = await controlPool.query(
    "select db_password from projects where name = $1",
    [name],
  );
  const password =
    (prev.rows[0]?.db_password as string | undefined) ??
    crypto.randomBytes(18).toString("base64url");

  const admin = adminClient();
  await admin.connect();
  try {
    await ensureGlobalRoles(admin);

    const r = await admin.query("select 1 from pg_roles where rolname = $1", [
      role,
    ]);
    if (!r.rowCount) {
      await admin.query(
        `create role ${ident(role)} login noinherit password ${lit(password)}`,
      );
      await admin.query(`grant anon, authenticated to ${ident(role)}`);
    } else if (!prev.rows[0]?.db_password) {
      // Role exists but we never stored its password — reset to a known one.
      await admin.query(`alter role ${ident(role)} password ${lit(password)}`);
    }

    const d = await admin.query(
      "select 1 from pg_database where datname = $1",
      [database],
    );
    if (!d.rowCount) {
      await admin.query(`create database ${ident(database)}`);
    }

    // Only this project's role may connect to this database.
    await admin.query(`revoke connect on database ${ident(database)} from public`);
    await admin.query(
      `grant connect on database ${ident(database)} to ${ident(role)}`,
    );
  } finally {
    await admin.end();
  }

  // Apply base schema as superuser → tables owned by postgres, not by the app
  // role, so RLS actually applies to the authenticator.
  const target = dbClient(database);
  await target.connect();
  let applied: string[] = [];
  try {
    applied = await applyMigrations(target, projectMigrationsDir);
  } finally {
    await target.end();
  }

  const organizationId = await defaultOrgId();
  await controlPool.query(
    `insert into projects (name, database, role, db_password, tenant_external_id, organization_id)
       values ($1, $2, $3, $4, $5, $6)
     on conflict (name) do update
       set db_password = excluded.db_password,
           tenant_external_id = excluded.tenant_external_id,
           organization_id = coalesce(projects.organization_id, excluded.organization_id)`,
    [name, database, role, password, externalId, organizationId],
  );

  // Route the project through the pooler when one is configured: the
  // authenticator in transaction mode (RLS-bound data — the claim is injected
  // per transaction). Direct connection otherwise.
  let pooled = false;
  let connectionString = connStr(database, role, password);
  if (poolerEnabled()) {
    await registerTenant({
      externalId,
      database,
      users: [{ dbUser: role, dbPassword: password, mode: "transaction" }],
    });
    connectionString = poolerConnectionString({
      externalId,
      database,
      dbUser: role,
      dbPassword: password,
    });
    pooled = true;
  }

  return { name, database, role, applied, connectionString, pooled };
}

/**
 * Tear down a project — the inverse of createProject:
 *  - stop the project's PostgREST, if any (releases its db connections)
 *  - stop the project's GoTrue (releases its connections to the db)
 *  - deregister the Supavisor tenant (release pooler connections)
 *  - drop the database (FORCE — terminate any straggler backends; pg ≥ 13)
 *  - drop the per-project authenticator role
 *  - delete the control-registry row
 * Idempotent: a missing container/tenant/db/role/row is treated as already-gone,
 * so a partially-completed earlier teardown can always be retried to completion.
 */
export async function destroyProject(
  name: string,
): Promise<{ name: string; database: string; dropped: boolean }> {
  if (!SLUG.test(name)) {
    throw new Error(
      `invalid project name '${name}' (a-z, 0-9, _, must start with a letter)`,
    );
  }

  const database = `db_${name}`;
  const role = `${name}_authenticator`;

  // Prefer the registered tenant id; fall back to the convention (the name).
  const reg = await controlPool.query(
    "select tenant_external_id from projects where name = $1",
    [name],
  );
  const externalId =
    (reg.rows[0]?.tenant_external_id as string | undefined) ?? name;

  // 1. Stop the project's satellites first, so they stop reconnecting to the db.
  //    REST + realtime are à-la-carte (may not exist) — both are idempotent.
  await destroyRest(name);
  await destroyStorageApi(name);
  await destroyRealtime(name);
  if (config.authProvisioner !== "none") {
    await destroyAuth(name);
  }
  // The project's bucket + key on the object store (external; idempotent).
  await destroyStorage(name);

  // 2. Release the pooler, so no upstream connection blocks the drop.
  if (poolerEnabled()) {
    await deregisterTenant(externalId);
  }

  const admin = adminClient();
  await admin.connect();
  try {
    // 3. Drop the database (FORCE terminates remaining backends).
    await admin.query(`drop database if exists ${ident(database)} with (force)`);
    // 4. The role is only droppable once the database is gone.
    await admin.query(`drop role if exists ${ident(role)}`);
  } finally {
    await admin.end();
  }

  // 5. Forget it in the registry.
  await controlPool.query("delete from projects where name = $1", [name]);

  return { name, database, dropped: true };
}

export async function listProjects(organizationId?: string) {
  const { rows } = await controlPool.query(
    `select name, database, role, status, status_detail,
            gotrue_url, postgrest_url, rest_requested, organization_id, created_at
       from projects
      where $1::uuid is null or organization_id = $1::uuid
      order by created_at`,
    [organizationId ?? null],
  );
  return rows;
}

function ident(s: string) {
  return '"' + s.replace(/"/g, '""') + '"';
}
function lit(s: string) {
  return "'" + s.replace(/'/g, "''") + "'";
}
function connStr(database: string, role: string, pw: string) {
  const u = new URL(config.adminUrl);
  return `postgres://${role}:${pw}@${u.hostname}:${u.port}/${database}`;
}
