import pg from "pg";

const { Pool } = pg;

function ident(s: string): string {
  return '"' + s.replace(/"/g, '""') + '"';
}

function decodeClaims(accessToken: string): Record<string, unknown> {
  const payload = accessToken.split(".")[1];
  if (!payload) throw new Error("not a JWT");
  return JSON.parse(Buffer.from(payload, "base64url").toString());
}

/**
 * The data namespace — server-only. Connects to the project's pooled Postgres
 * and runs every statement inside a transaction as the non-owner `authenticated`
 * role, with the user's token claims injected. RLS is therefore always applied,
 * and the caller never injects a claim by hand.
 */
export class DbClient {
  private readonly pool: pg.Pool;
  constructor(connectionString: string) {
    this.pool = new Pool({ connectionString, max: 5 });
  }

  /** Scope all queries to the user identified by `accessToken`. */
  asUser(accessToken: string): UserScopedDb {
    return new UserScopedDb(this.pool, decodeClaims(accessToken));
  }

  end(): Promise<void> {
    return this.pool.end();
  }
}

export class UserScopedDb {
  constructor(
    private readonly pool: pg.Pool,
    private readonly claims: Record<string, unknown>,
  ) {}

  /** Run `fn` in one RLS-bound transaction (claims injected, role = authenticated). */
  async tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query("begin");
      await c.query("set local role authenticated");
      await c.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(this.claims),
      ]);
      const out = await fn(c);
      await c.query("commit");
      return out;
    } catch (e) {
      await c.query("rollback").catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }

  async query<R extends pg.QueryResultRow = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<R[]> {
    return this.tx((c) => c.query<R>(text, params).then((r) => r.rows));
  }

  async insert<R extends pg.QueryResultRow = Record<string, unknown>>(
    table: string,
    values: Record<string, unknown>,
  ): Promise<R> {
    const keys = Object.keys(values);
    const cols = keys.map(ident).join(", ");
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
    return this.tx((c) =>
      c
        .query<R>(
          `insert into ${ident(table)} (${cols}) values (${placeholders}) returning *`,
          keys.map((k) => values[k]),
        )
        .then((r) => r.rows[0]),
    );
  }

  async select<R extends pg.QueryResultRow = Record<string, unknown>>(
    table: string,
  ): Promise<R[]> {
    return this.query<R>(`select * from ${ident(table)}`);
  }
}
