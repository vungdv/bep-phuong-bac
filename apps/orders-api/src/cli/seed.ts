import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';
import { loadConfig } from '../config.js';
import { createPool } from '../store/pool.js';

const SAMPLES: Array<[string, number, string]> = [
  ['Nguyen Van A', 2, 'No chili'],
  ['Tran Thi B', 1, ''],
  ['Le Van C', 3, 'Extra sauce'],
  ['Pham Thi D', 1, ''],
];

function addDays(base: Date, n: number): string {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate() + n));
  return d.toISOString().slice(0, 10);
}

/** Inserts sample orders for yesterday, today and tomorrow. Idempotent. Returns rows inserted. */
export async function seed(pool: Pick<Pool, 'query'>, today: Date = new Date()): Promise<number> {
  let inserted = 0;
  for (const offset of [-1, 0, 1]) {
    const date = addDays(today, offset);
    for (const [i, [name, qty, message]] of SAMPLES.entries()) {
      const no = i + 1;
      // Deterministic id from (date, no) so re-seeding hits ON CONFLICT.
      const res = await pool.query(
        `INSERT INTO orders (id, service_date, no, name, qty, message, delivered)
         VALUES (md5($1::text || ':' || $2::int::text)::uuid, $1::date, $2::int, $3, $4::int, $5, false)
         ON CONFLICT DO NOTHING`,
        [date, no, name, qty, message],
      );
      inserted += res.rowCount ?? 0;
    }
  }
  return inserted;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool(loadConfig().databaseUrl);
  seed(pool)
    .then((n) => console.log(JSON.stringify({ msg: 'seeded', inserted: n })))
    .catch((err: unknown) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
