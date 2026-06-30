import { preflightSource, formatPreflight, type Preflight } from "./preflight";
import { createProject } from "./provision";
import { provisionRest } from "./postgrest";
import { provisionStorageApi } from "./storageapi";
import { config, endpointFor } from "./config";

/**
 * migrate-in — import a Supabase project into the Hauldr fleet. Orchestrates the
 * 7 gates proven on Viken (ADR-0002; full as-built in Edda pilares/hauldr-migracao).
 *
 * What this command DOES automatically:
 *   1. Preflight (read-only, Management API) — go/no-go inventory.
 *   2. Provision the target project + the data plane (auth, REST, storage).
 *
 * What it EMITS as a guided checklist (the data gates need the source's Postgres
 * connection string + storage S3 access + operator oversight — destructive-ish,
 * run with eyes on): dump/restore, storage objects, functions plane, verify.
 *
 * Keys: the Hauldr project mints its own JWT secret (Supabase's new signing-key
 * projects hide the legacy HS256 secret) — anon/service_role come out of
 * getProjectDetail; bcrypt hashes migrate 1:1 regardless, so the moat (a real
 * user logging in) still holds.
 */

export type MigrateInResult = {
  name: string;
  preflight: Preflight;
  baseUrl: string;
  provisioned: { auth: boolean; rest: boolean; storage: boolean };
  /** The remaining operator-run gates, as codified commands. */
  nextGates: string[];
};

function projectBaseUrl(name: string): string {
  const { host } = endpointFor(name, "prod", "auth");
  return `${config.endpointScheme}://${host}`;
}

export async function migrateIn(opts: {
  name: string;
  ref: string;
  pat?: string;
}): Promise<MigrateInResult> {
  const { name, ref } = opts;

  // ── Gate 1: preflight (read-only) ──────────────────────────────────────────
  const preflight = await preflightSource(ref, opts.pat);

  // ── Gate 2: provision the target + data plane ──────────────────────────────
  // createProject is idempotent-by-name (mints the JWT secret, db, GoTrue).
  await createProject(name);
  await provisionRest(name);
  let storage = false;
  if (preflight.counts.buckets > 0 && config.garageS3Endpoint) {
    await provisionStorageApi(name);
    storage = true;
  }

  const baseUrl = projectBaseUrl(name);
  const fnDir = `${config.functionsDir}/${name}`;

  // ── Gates 3–7: emitted as codified, operator-run steps ─────────────────────
  // These need the source's Postgres connection string (dump) + S3 access
  // (objects) + eyes-on; they are destructive-ish, so migrate-in guides rather
  // than auto-runs them. Each line is a real command from the proven runbook.
  const nextGates = [
    `# 3. Schema + dados (precisa da connection string da origem):`,
    `#    pg_dump --schema=public            > public.sql   # schema+data`,
    `#    pg_dump --schema=auth   --data-only > auth.sql     # bcrypt 1:1`,
    `#    pg_dump --schema=storage --data-only > storage.sql`,
    `#    sed -i '/^SET transaction_timeout/d' *.sql         # PG17→16`,
    `#    restore via: docker exec -i <hauldr-db> psql -U postgres -d db_${name}`,
    `#      com 'SET session_replication_role=replica;' no começo do stream;`,
    `#      depois: CREATE EXTENSION btree_gist; reaplicar FKs→auth.users +`,
    `#      EXCLUDE constraints; re-GRANT anon/authenticated/service_role.`,
    `# 4. Storage: baixar objetos da URL pública da origem → POST /storage/v1/object`,
    `#      (x-upsert) no storage de ${baseUrl}.`,
    `# 5. Functions: puxar o DEPLOYADO (${preflight.deployedFunctions.length} funcs, eszip) p/ ${fnDir}/`,
    `#      (+ router main/), então: cli functions ${name}`,
    `# 6. Cron: registrar ${preflight.cronJobs.length} job(s) em Midgard hauldr_functions_cron.`,
    `# 7. Verify: login de user real (bcrypt 1:1) + .from() + realtime + storage round-trip.`,
  ];

  return {
    name,
    preflight,
    baseUrl,
    provisioned: { auth: true, rest: true, storage },
    nextGates,
  };
}

export { formatPreflight };
