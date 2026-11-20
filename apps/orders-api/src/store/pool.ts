import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export const MIGRATIONS_TABLE = 'pgmigrations';
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

export interface PoolOptions {
  max?: number;
  connectionTimeoutMs?: number;
  statementTimeoutMs?: number;
}

export function createPool(databaseUrl: string, opts: PoolOptions = {}): pg.Pool {
  const pool = new pg.Pool({
    connectionString: databaseUrl,
    max: opts.max ?? 10,
    connectionTimeoutMillis: opts.connectionTimeoutMs ?? 5_000,
    statement_timeout: opts.statementTimeoutMs ?? 5_000,
  });
  // Idle client errors must not crash the process.
  pool.on('error', () => {});
  return pool;
}

/** Liveness of the database connection (readiness input). */
export async function checkHealth(pool: Pick<pg.Pool, 'query'>): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/** Migration names (without extension) shipped with this service, in order. */
export function listMigrationNames(dir: string = MIGRATIONS_DIR): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => f.replace(/\.sql$/, ''))
    .sort();
}

/** True when every shipped migration has been applied (S4: readiness reports a behind schema). */
export async function checkSchemaVersion(
  pool: Pick<pg.Pool, 'query'>,
  expected: string[] = listMigrationNames(),
): Promise<boolean> {
  try {
    const res = await pool.query<{ name: string }>(`SELECT name FROM ${MIGRATIONS_TABLE}`);
    const applied = new Set(res.rows.map((r) => r.name));
    return expected.every((n) => applied.has(n));
  } catch {
    return false; // table missing or DB unreachable
  }
}
