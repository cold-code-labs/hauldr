import type pg from "pg";

/**
 * Shared, cluster-global, NOLOGIN privilege roles (à la Supabase).
 * Generic migrations reference these by name; per-project login roles
 * (the "authenticator") get membership and SET ROLE into them.
 *
 * `service_role` and `supabase_realtime_admin` exist for the shared Realtime
 * service: its per-tenant migrations GRANT to `service_role` and run internal
 * queries as `supabase_realtime_admin`, so both must exist cluster-wide before a
 * project can be registered as a Realtime tenant. Harmless for projects that
 * never enable realtime (they're just unused NOLOGIN roles).
 */
const GLOBAL_ROLES: Array<{ name: string; create: string }> = [
  { name: "anon", create: `create role "anon" nologin` },
  { name: "authenticated", create: `create role "authenticated" nologin` },
  { name: "service_role", create: `create role "service_role" nologin noinherit bypassrls` },
  { name: "supabase_realtime_admin", create: `create role "supabase_realtime_admin" nologin noinherit` },
];

export async function ensureGlobalRoles(admin: pg.Client) {
  for (const role of GLOBAL_ROLES) {
    const { rowCount } = await admin.query(
      "select 1 from pg_roles where rolname = $1",
      [role.name],
    );
    if (!rowCount) await admin.query(role.create);
  }
}
