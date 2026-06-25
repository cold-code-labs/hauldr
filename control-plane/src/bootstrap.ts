import { adminClient, dbClient } from "./db";
import { applyMigrations } from "./migrate";
import { controlMigrationsDir } from "./paths";
import { config } from "./config";
import { ensureProjectZero } from "./zero";
import { ensureDefaultOrganization, adoptOrphanProjects } from "./orgs";

/** Create the control db (`hauldr`) if missing and apply its migrations. */
export async function bootstrap() {
  const admin = adminClient();
  await admin.connect();
  try {
    const d = await admin.query(
      "select 1 from pg_database where datname = $1",
      [config.controlDb],
    );
    if (!d.rowCount) {
      await admin.query(`create database "${config.controlDb}"`);
      console.log(`created control db '${config.controlDb}'`);
    } else {
      console.log(`control db '${config.controlDb}' already exists`);
    }
  } finally {
    await admin.end();
  }

  const c = dbClient(config.controlDb);
  await c.connect();
  try {
    const applied = await applyMigrations(c, controlMigrationsDir);
    console.log(
      `control migrations: ${applied.length ? applied.join(", ") : "(none new)"}`,
    );
  } finally {
    await c.end();
  }

  // Project zero — prepare its database so GoTrue can migrate cleanly on boot.
  if (config.jwtSecret) {
    await ensureProjectZero();
    console.log(`project zero db ready: ${config.zeroDb}`);
  }

  // Unattended install: when a master operator is configured via the environment
  // (HAULDR_MASTER_*), the install is meant to come up ready — so ensure the
  // default organization (tenant zero) exists and adopt any orphan projects into
  // it. A fresh install with no env master stays uninitialized until the
  // first-run wizard creates the master + organization.
  if (config.jwtSecret && config.masterPassword) {
    const org = await ensureDefaultOrganization(config.defaultOrgName);
    const adopted = await adoptOrphanProjects(org.id);
    console.log(
      `default organization ready: ${org.name} (${org.slug})` +
        (adopted ? ` — adopted ${adopted} orphan project(s)` : ""),
    );
  }

  // Supavisor metadata db — Supavisor's own `migrate` populates it, but the
  // database itself must exist before the pooler boots. Created here so the
  // pooler can depend on the control plane being healthy.
  if (config.poolerApiSecret) {
    await ensureDatabase(config.poolerMetaDb);
    console.log(`supavisor metadata db ready: ${config.poolerMetaDb}`);
  }

  // Realtime metadata db — the shared Realtime service migrates its own
  // tenants/extensions tables into the `_realtime` schema on boot, but it
  // connects with search_path=_realtime and so can create neither the database
  // nor the schema. Create both here so Realtime comes up clean.
  if (config.realtimeUrl) {
    await ensureDatabase("_realtime");
    const rt = dbClient("_realtime");
    await rt.connect();
    try {
      await rt.query("create schema if not exists _realtime");
    } finally {
      await rt.end();
    }
    console.log("realtime metadata db ready: _realtime");
  }

  // Fleet jobs — the shared pg-boss worker's store. Ensure its login role and a
  // dedicated database that role OWNS, so pg-boss can create its `pgboss` schema
  // and tables on first boot. This is a singleton fleet service (one worker for
  // the whole fleet, like Realtime), not a per-project tenant — so it lives in
  // bootstrap beside the other infra dbs, not in provisionDatabase. Gated on a
  // configured password: no password → jobs are not deployed, skip the step.
  if (config.jobsRolePassword) {
    await ensureJobsStore();
    console.log(
      `fleet jobs store ready: ${config.jobsDb} (owner ${config.jobsRole})`,
    );
  }
}

/**
 * Ensure the fleet-jobs worker role and its database. The role is a plain login
 * role (no anon/authenticated membership — this is infra, not an RLS tenant);
 * it OWNS its database so pg-boss can create its schema. Idempotent: the
 * password is (re)asserted from the environment, which is the source of truth.
 */
async function ensureJobsStore(): Promise<void> {
  const admin = adminClient();
  await admin.connect();
  try {
    const role = config.jobsRole;
    const r = await admin.query("select 1 from pg_roles where rolname = $1", [
      role,
    ]);
    if (!r.rowCount) {
      await admin.query(
        `create role ${ident(role)} login password ${lit(config.jobsRolePassword)}`,
      );
    } else {
      await admin.query(
        `alter role ${ident(role)} login password ${lit(config.jobsRolePassword)}`,
      );
    }
    // CREATE DATABASE can't run in a transaction and can't be parameterized;
    // names are operator-config, quoted defensively all the same.
    const d = await admin.query(
      "select 1 from pg_database where datname = $1",
      [config.jobsDb],
    );
    if (!d.rowCount) {
      await admin.query(
        `create database ${ident(config.jobsDb)} owner ${ident(role)}`,
      );
    }
  } finally {
    await admin.end();
  }
}

function ident(s: string) {
  return '"' + s.replace(/"/g, '""') + '"';
}
function lit(s: string) {
  return "'" + s.replace(/'/g, "''") + "'";
}

/** Create a database if it does not already exist. */
async function ensureDatabase(name: string): Promise<void> {
  const admin = adminClient();
  await admin.connect();
  try {
    const d = await admin.query(
      "select 1 from pg_database where datname = $1",
      [name],
    );
    if (!d.rowCount) {
      await admin.query(`create database "${name}"`);
    }
  } finally {
    await admin.end();
  }
}

bootstrap()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
