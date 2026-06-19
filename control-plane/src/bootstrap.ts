import { adminClient, dbClient } from "./db";
import { applyMigrations } from "./migrate";
import { controlMigrationsDir } from "./paths";
import { config } from "./config";
import { ensureProjectZero } from "./zero";

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

  // Supavisor metadata db — Supavisor's own `migrate` populates it, but the
  // database itself must exist before the pooler boots. Created here so the
  // pooler can depend on the control plane being healthy.
  if (config.poolerApiSecret) {
    await ensureDatabase(config.poolerMetaDb);
    console.log(`supavisor metadata db ready: ${config.poolerMetaDb}`);
  }
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
