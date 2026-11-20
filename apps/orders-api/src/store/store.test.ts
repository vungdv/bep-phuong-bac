import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../cli/migrate.js';
import { seed } from '../cli/seed.js';
import { startPostgres } from '../test-db.js';
import { PgOrdersRepository } from './pg-orders-repository.js';
import { checkHealth, checkSchemaVersion, createPool, listMigrationNames } from './pool.js';

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;
let repo: PgOrdersRepository;

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ID3 = '33333333-3333-4333-8333-333333333333';

async function insert(id: string, date: string, no: number, extra: { qty?: number; message?: string; at?: string } = {}) {
  await pool.query(
    `INSERT INTO orders (id, service_date, no, name, qty, message, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))`,
    [id, date, no, `name-${no}`, extra.qty ?? 1, extra.message ?? '', extra.at ?? null],
  );
}

beforeAll(async () => {
  container = await startPostgres();
  await migrate(container.getConnectionUri());
  pool = createPool(container.getConnectionUri());
  repo = new PgOrdersRepository(pool);
});

afterAll(async () => {
  await pool?.end();
  await container?.stop();
});

beforeEach(async () => {
  await pool.query('TRUNCATE orders');
});

describe('migrations', () => {
  it('re-applying changes nothing', async () => {
    const before = await pool.query('SELECT name, run_on FROM pgmigrations ORDER BY id');
    expect(await migrate(container.getConnectionUri())).toEqual([]);
    const after = await pool.query('SELECT name, run_on FROM pgmigrations ORDER BY id');
    expect(after.rows).toEqual(before.rows);
  });

  it('applies to a fresh empty database and creates the schema', async () => {
    const admin = new pg.Client({ connectionString: container.getConnectionUri() });
    await admin.connect();
    await admin.query('CREATE DATABASE fresh');
    await admin.end();
    const url = new URL(container.getConnectionUri());
    url.pathname = '/fresh';
    const applied = await migrate(url.toString());
    expect(applied).toEqual(['0001_create_orders']);
    const p = createPool(url.toString());
    try {
      const cols = await p.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'orders'`,
      );
      const types = Object.fromEntries(cols.rows.map((r) => [r.column_name, r.data_type]));
      expect(types).toMatchObject({
        service_date: 'date',
        created_at: 'timestamp with time zone',
        delivered: 'boolean',
      });
      const idx = await p.query(`SELECT 1 FROM pg_indexes WHERE indexname = 'orders_service_date_idx'`);
      expect(idx.rowCount).toBe(1);
    } finally {
      await p.end();
    }
  });

  it('enforces unique (service_date, no)', async () => {
    await insert(ID1, '2026-11-20', 1);
    await expect(insert(ID2, '2026-11-20', 1)).rejects.toMatchObject({ code: '23505' });
    await insert(ID2, '2026-11-21', 1);
  });

  it('enforces qty > 0 and no > 0', async () => {
    await expect(insert(ID1, '2026-11-20', 1, { qty: 0 })).rejects.toMatchObject({ code: '23514' });
    await expect(insert(ID1, '2026-11-20', 0)).rejects.toMatchObject({ code: '23514' });
  });
});

describe('schema version / health', () => {
  it('reports ready on migrated db, healthy', async () => {
    expect(await checkSchemaVersion(pool)).toBe(true);
    expect(await checkHealth(pool)).toBe(true);
  });

  it('reports not ready when a shipped migration is not applied', async () => {
    expect(await checkSchemaVersion(pool, [...listMigrationNames(), '9999_future'])).toBe(false);
  });
});

describe('PgOrdersRepository.listByServiceDate', () => {
  it('filters by day, sorts by no, returns [] for an empty day', async () => {
    await insert(ID3, '2026-11-20', 3);
    await insert(ID1, '2026-11-20', 1);
    await insert(ID2, '2026-11-21', 1);
    const list = await repo.listByServiceDate('2026-11-20');
    expect(list.map((o) => o.no)).toEqual([1, 3]);
    expect(list.every((o) => o.serviceDate === '2026-11-20')).toBe(true);
    expect(await repo.listByServiceDate('2026-11-22')).toEqual([]);
  });

  it('returns exactly the spec fields with correct formats', async () => {
    await insert(ID1, '2026-11-20', 1, { qty: 2, message: 'No chili', at: '2026-11-19T08:30:00+07:00' });
    const [o] = await repo.listByServiceDate('2026-11-20');
    expect(o).toEqual({
      id: ID1,
      no: 1,
      name: 'name-1',
      qty: 2,
      message: 'No chili',
      createdAt: '2026-11-19T01:30:00.000+00:00',
      serviceDate: '2026-11-20',
      delivered: false,
    });
  });

  it('does not shift service dates under a non-UTC process timezone', async () => {
    const prev = process.env.TZ;
    process.env.TZ = 'Asia/Ho_Chi_Minh';
    try {
      await insert(ID1, '2026-11-20', 1);
      const [o] = await repo.listByServiceDate('2026-11-20');
      expect(o?.serviceDate).toBe('2026-11-20');
    } finally {
      if (prev === undefined) delete process.env.TZ;
      else process.env.TZ = prev;
    }
  });

  it('treats a hostile date as a bound parameter, never SQL', async () => {
    await insert(ID1, '2026-11-20', 1);
    await expect(repo.listByServiceDate("2026-11-20' OR '1'='1")).rejects.toBeTruthy();
    const count = await pool.query('SELECT count(*)::int AS n FROM orders');
    expect(count.rows[0].n).toBe(1);
  });
});

describe('PgOrdersRepository.setDelivered', () => {
  it('sets and clears the flag, idempotently, changing only delivered', async () => {
    await insert(ID1, '2026-11-20', 1, { message: 'hi', at: '2026-11-19T08:30:00Z' });
    const [before] = await repo.listByServiceDate('2026-11-20');
    const on = await repo.setDelivered(ID1, true);
    expect(on).toEqual({ ...before, delivered: true });
    expect(await repo.setDelivered(ID1, true)).toEqual(on);
    const off = await repo.setDelivered(ID1, false);
    expect(off).toEqual({ ...before, delivered: false });
    expect(await repo.listByServiceDate('2026-11-20')).toEqual([before]);
  });

  it('returns null for an unknown or non-UUID id', async () => {
    await insert(ID1, '2026-11-20', 1);
    expect(await repo.setDelivered(ID2, true)).toBeNull();
    expect(await repo.setDelivered('not-a-uuid', true)).toBeNull();
    expect((await repo.listByServiceDate('2026-11-20'))[0]?.delivered).toBe(false);
  });
});

describe('seed', () => {
  it('seeds yesterday/today/tomorrow and is idempotent', async () => {
    const today = new Date('2026-11-20T12:00:00Z');
    const n = await seed(pool, today);
    expect(n).toBeGreaterThan(0);
    for (const d of ['2026-11-19', '2026-11-20', '2026-11-21']) {
      expect((await repo.listByServiceDate(d)).length).toBeGreaterThanOrEqual(3);
    }
    expect(await seed(pool, today)).toBe(0);
  });
});
