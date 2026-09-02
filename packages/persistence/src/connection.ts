import fs from 'node:fs';
import pg from 'pg';

export type Queryer = <R extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: unknown[],
) => Promise<{ rows: R[]; rowCount: number }>;

export interface DatabasePool {
  query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number }>;
  close(): Promise<void>;
}

/**
 * Resolved SSL configuration suitable for `pg.Pool({ ssl })`. Two shapes
 * are useful: `false` (plaintext) or a tls.ConnectionOptions-shaped record.
 * Exported as an interface (not the raw `pg.PoolConfig['ssl']`) so the
 * persistence package keeps its public surface minimal.
 */
export interface PostgresSslConfig {
  rejectUnauthorized: boolean;
  ca?: string;
}

export interface PostgresSslEnv {
  /** `REMOTE_AGENT_PG_CA_PATH` — path to a PEM CA bundle for verify-ca/verify-full. */
  caPath?: string;
  /**
   * `REMOTE_AGENT_PG_REJECT_UNAUTHORIZED` — explicit override. Use this to
   * bring up self-signed lab clusters under verify-full without editing
   * code, or to force-tighten a `require` deployment.
   */
  rejectUnauthorizedOverride?: 'true' | 'false';
}

/**
 * Parse the libpq-style `sslmode=` parameter from a connection string.
 * Returns `null` when no sslmode is present or the URL is unparseable
 * (callers treat that as "no TLS").
 *
 * Recognised values follow libpq: `disable`, `allow`, `prefer`, `require`,
 * `verify-ca`, `verify-full`. Anything else returns `null`.
 */
export function parsePostgresSslMode(connectionString: string): string | null {
  try {
    const url = new URL(connectionString);
    const mode = url.searchParams.get('sslmode');
    if (!mode) return null;
    const known = ['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full'];
    return known.includes(mode) ? mode : null;
  } catch {
    return null;
  }
}

/**
 * Build the pg `ssl` config for a given mode + env. SaaS Stage 1 needs to
 * pass managed-Postgres TLS handshakes (RDS, Cloud SQL, etc.) without
 * surprises:
 *
 *   - `disable`/`allow`/`prefer` ⇒ `false` (no TLS).
 *   - `require` ⇒ encrypted but no cert verification (the libpq default,
 *     matches the historical behavior of this codebase). Operators who
 *     want stricter trust set `REMOTE_AGENT_PG_REJECT_UNAUTHORIZED=true`.
 *   - `verify-ca` / `verify-full` ⇒ encrypted **and** cert-verified. A CA
 *     bundle from `REMOTE_AGENT_PG_CA_PATH` is loaded if present; otherwise
 *     Node uses its system bundle (sufficient for AWS RDS et al.).
 *
 * Returns `false` for plaintext modes and a `PostgresSslConfig` otherwise.
 */
export function resolvePostgresSslConfig(
  mode: string | null,
  env: PostgresSslEnv = {},
  readFile: (p: string) => string = (p) => fs.readFileSync(p, 'utf8'),
): false | PostgresSslConfig {
  if (!mode || mode === 'disable' || mode === 'allow' || mode === 'prefer') return false;

  const overrideRaw = env.rejectUnauthorizedOverride;
  const override = overrideRaw === 'true' ? true : overrideRaw === 'false' ? false : null;
  const ca = env.caPath ? readFile(env.caPath) : undefined;

  if (mode === 'require') {
    return { rejectUnauthorized: override ?? false, ...(ca ? { ca } : {}) };
  }
  // verify-ca / verify-full
  return { rejectUnauthorized: override ?? true, ...(ca ? { ca } : {}) };
}

export class PgPool implements DatabasePool {
  private readonly pool: pg.Pool;

  constructor(connectionString: string) {
    const mode = parsePostgresSslMode(connectionString);
    const ssl = resolvePostgresSslConfig(mode, {
      caPath: process.env.REMOTE_AGENT_PG_CA_PATH,
      rejectUnauthorizedOverride:
        process.env.REMOTE_AGENT_PG_REJECT_UNAUTHORIZED === 'true' ? 'true' :
        process.env.REMOTE_AGENT_PG_REJECT_UNAUTHORIZED === 'false' ? 'false' :
        undefined,
    });
    this.pool = new pg.Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ssl: ssl === false ? undefined : ssl,
    });
  }

  async query<R extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: R[]; rowCount: number }> {
    const result = await this.pool.query<R>(text, values);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  }

  /**
   * Run `fn` inside a single BEGIN/COMMIT on one dedicated connection so
   * multi-table writes (e.g. board assign = close+insert+update+event) are atomic.
   * Rolls back and rethrows on any error.
   */
  async withTransaction<T>(fn: (q: Queryer) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const q: Queryer = async (text, values) => {
        const r = await client.query(text, values as unknown[]);
        return { rows: r.rows as never[], rowCount: r.rowCount ?? 0 };
      };
      const out = await fn(q);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore rollback failure; surface the original error */
      }
      throw err;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
