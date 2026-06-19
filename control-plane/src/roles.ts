import type pg from "pg";

/**
 * Shared, cluster-global, NOLOGIN privilege roles (à la Supabase).
 * Generic migrations reference these by name; per-project login roles
 * (the "authenticator") get membership and SET ROLE into them.
 */
export async function ensureGlobalRoles(admin: pg.Client) {
  for (const role of ["anon", "authenticated"]) {
    const { rowCount } = await admin.query(
      "select 1 from pg_roles where rolname = $1",
      [role],
    );
    if (!rowCount) await admin.query(`create role "${role}" nologin`);
  }
}
