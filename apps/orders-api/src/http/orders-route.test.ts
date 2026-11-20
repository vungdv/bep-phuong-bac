import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { migrate } from '../cli/migrate.js';
import { createOrdersService } from '../service/orders-service.js';
import { buildServer } from '../server.js';
import { PgOrdersRepository } from '../store/pg-orders-repository.js';
import { createPool } from '../store/pool.js';
import { startPostgres } from '../test-db.js';

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;
let app: FastifyInstance;

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

async function insert(n: number, date: string, no: number, extra: { message?: string; at?: string } = {}) {
  await pool.query(
    `INSERT INTO orders (id, service_date, no, name, qty, message, created_at)
     VALUES ($1, $2, $3, $4, 2, $5, COALESCE($6::timestamptz, now()))`,
    [id(n), date, no, `name-${no}`, extra.message ?? '', extra.at ?? null],
  );
}

beforeAll(async () => {
  container = await startPostgres();
  await migrate(container.getConnectionUri());
  pool = createPool(container.getConnectionUri());
  app = buildServer({ service: createOrdersService(new PgOrdersRepository(pool)) });
  await app.ready();
});

afterAll(async () => {
  await app?.close();
  await pool?.end();
  await container?.stop();
});

beforeEach(async () => {
  await pool.query('TRUNCATE orders');
});

function expectProblem(res: { statusCode: number; headers: Record<string, unknown>; json: () => unknown }, status: number) {
  expect(res.statusCode).toBe(status);
  expect(String(res.headers['content-type'])).toMatch(/^application\/problem\+json/);
  const body = res.json() as Record<string, unknown>;
  expect(body.status).toBe(status);
  expect(String(body.type)).toMatch(/^https:\/\/bepphuongbac\.example\/problems\/[a-z-]+$/);
  expect(typeof body.title).toBe('string');
  expect(typeof body.detail).toBe('string');
  return body;
}

describe('GET /orders', () => {
  it('returns only the requested day, sorted by no, with JSON and no-cache', async () => {
    await insert(3, '2026-11-20', 3);
    await insert(1, '2026-11-20', 1);
    await insert(2, '2026-11-20', 2);
    await insert(4, '2026-11-19', 1);
    await insert(5, '2026-11-21', 1);
    const res = await app.inject('/orders?serviceDate=2026-11-20');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/json/);
    expect(res.headers['cache-control']).toBe('no-cache');
    const body = res.json() as Array<{ no: number; serviceDate: string; id: string }>;
    expect(body.map((o) => o.no)).toEqual([1, 2, 3]);
    expect(body.every((o) => o.serviceDate === '2026-11-20')).toBe(true);
    expect(body.map((o) => o.id)).toEqual([id(1), id(2), id(3)]);
  });

  it('returns [] for an empty day', async () => {
    await insert(1, '2026-11-20', 1);
    const res = await app.inject('/orders?serviceDate=2026-11-22');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns exactly the eight fields with the specified formats', async () => {
    await insert(1, '2026-11-20', 1, { message: 'No chili', at: '2026-11-19T08:30:00+07:00' });
    await insert(2, '2026-11-20', 2);
    const body = (await app.inject('/orders?serviceDate=2026-11-20')).json();
    expect(body[0]).toEqual({
      id: id(1),
      no: 1,
      name: 'name-1',
      qty: 2,
      message: 'No chili',
      createdAt: '2026-11-19T01:30:00.000+00:00',
      serviceDate: '2026-11-20',
      delivered: false,
    });
    expect(Object.keys(body[1]).sort()).toEqual(
      ['createdAt', 'delivered', 'id', 'message', 'name', 'no', 'qty', 'serviceDate'],
    );
    expect(body[1].message).toBe('');
    expect(typeof body[1].delivered).toBe('boolean');
    expect(body[1].createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?\+00:00$/);
  });

  it('supports HEAD with headers and no body', async () => {
    await insert(1, '2026-11-20', 1);
    const res = await app.inject({ method: 'HEAD', url: '/orders?serviceDate=2026-11-20' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('no-cache');
    expect(res.body).toBe('');
  });

  it('ignores unknown query parameters', async () => {
    await insert(1, '2026-11-20', 1);
    const res = await app.inject('/orders?serviceDate=2026-11-20&foo=bar&foo=baz&x[]=1');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });
});

describe('validation', () => {
  it.each([
    ['missing', '/orders'],
    ['empty', '/orders?serviceDate='],
    ['malformed', '/orders?serviceDate=abc'],
    ['month 13', '/orders?serviceDate=2026-13-01'],
    ['feb 30', '/orders?serviceDate=2026-02-30'],
    ['wrong format', '/orders?serviceDate=20-11-2026'],
    ['timestamp', '/orders?serviceDate=2026-11-20T00:00:00Z'],
    ['repeated', '/orders?serviceDate=2026-11-20&serviceDate=2026-11-21'],
    ['hostile', "/orders?serviceDate=2026-11-20'%20OR%20'1'='1"],
  ])('%s date -> 400 problem+json', async (_n, url) => {
    const res = await app.inject(url);
    const body = expectProblem(res, 400);
    expect(body.type).toBe('https://bepphuongbac.example/problems/invalid-service-date');
    expect(body.title).toBe('Invalid service date');
    expect(body.detail).toBe('serviceDate must be a real date in YYYY-MM-DD form.');
  });

  it.each(['POST', 'PUT', 'DELETE', 'PATCH'] as const)('%s /orders -> 405 with Allow', async (method) => {
    const res = await app.inject({ method, url: '/orders', payload: method === 'DELETE' ? undefined : {} });
    expectProblem(res, 405);
    expect(res.headers.allow).toBe('GET, HEAD');
  });

  it('unknown path -> 404 problem+json', async () => {
    expectProblem(await app.inject('/nope'), 404);
  });
});

describe('error handling', () => {
  it('a throwing repository -> 500 problem+json without leaking internals', async () => {
    const bad = buildServer({
      service: createOrdersService({
        setDelivered: async () => null,
        listByServiceDate: async () => {
          throw new Error('SELECT * FROM orders WHERE secret failed at /srv/app/store.ts:42');
        },
      }),
      traceId: () => '4bf92f3577b34da6a3ce929d0e0e4736',
    });
    const res = await bad.inject('/orders?serviceDate=2026-11-20');
    const body = expectProblem(res, 500);
    expect(body.trace_id).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(res.body).not.toMatch(/SELECT|secret|store\.ts|at \w+/i);
    await bad.close();
  });

  it('an unreachable store -> 503 problem+json', async () => {
    const bad = buildServer({
      service: createOrdersService({
        setDelivered: async () => null,
        listByServiceDate: async () => {
          throw Object.assign(new Error('connect ECONNREFUSED 10.0.0.1:5432'), { code: 'ECONNREFUSED' });
        },
      }),
    });
    const res = await bad.inject('/orders?serviceDate=2026-11-20');
    const body = expectProblem(res, 503);
    expect(res.body).not.toMatch(/ECONNREFUSED|10\.0\.0\.1/);
    expect('trace_id' in body).toBe(false);
    await bad.close();
  });
});

describe('PATCH /orders/{id}', () => {
  const MP = { 'content-type': 'application/merge-patch+json' };
  const patch = (url: string, payload: string, headers: Record<string, string> = MP) =>
    app.inject({ method: 'PATCH', url, payload, headers });
  const stored = async () => (await pool.query('SELECT * FROM orders ORDER BY no')).rows;

  it('sets and clears the flag, returning the updated order with no-store', async () => {
    await insert(1, '2026-11-20', 1, { message: 'm' });
    const set = await patch(`/orders/${id(1)}`, '{"delivered":true}');
    expect(set.statusCode).toBe(200);
    expect(set.headers['content-type']).toMatch(/^application\/json/);
    expect(set.headers['cache-control']).toBe('no-store');
    expect(set.json()).toMatchObject({ id: id(1), no: 1, name: 'name-1', qty: 2, message: 'm', serviceDate: '2026-11-20', delivered: true });
    expect(Object.keys(set.json()).sort()).toEqual(
      ['createdAt', 'delivered', 'id', 'message', 'name', 'no', 'qty', 'serviceDate'],
    );
    const clear = await patch(`/orders/${id(1)}`, '{"delivered":false}');
    expect(clear.statusCode).toBe(200);
    expect(clear.json().delivered).toBe(false);
  });

  it('is idempotent and persists across requests', async () => {
    await insert(1, '2026-11-20', 1);
    const a = await patch(`/orders/${id(1)}`, '{"delivered":true}');
    const b = await patch(`/orders/${id(1)}`, '{"delivered":true}');
    expect(b.statusCode).toBe(200);
    expect(b.json()).toEqual(a.json());
    const list = (await app.inject('/orders?serviceDate=2026-11-20')).json();
    expect(list[0].delivered).toBe(true);
  });

  it('accepts a charset parameter on the media type', async () => {
    await insert(1, '2026-11-20', 1);
    const res = await patch(`/orders/${id(1)}`, '{"delivered":true}', {
      'content-type': 'application/merge-patch+json; charset=utf-8',
    });
    expect(res.statusCode).toBe(200);
  });

  it('changes only the delivered column', async () => {
    await insert(1, '2026-11-20', 1, { message: 'x', at: '2026-11-19T08:30:00+07:00' });
    const [before] = await stored();
    await patch(`/orders/${id(1)}`, '{"delivered":true}');
    const [after] = await stored();
    expect({ ...after, delivered: before.delivered }).toEqual(before);
    expect(after.delivered).toBe(true);
  });

  it.each([
    ['unknown id', '00000000-0000-4000-8000-0000000000ff'],
    ['non-uuid id', 'not-a-uuid'],
    ['sql-ish id', "1'%20OR%20'1'='1"],
  ])('%s -> 404 problem+json', async (_n, bad) => {
    await insert(1, '2026-11-20', 1);
    const res = await patch(`/orders/${bad}`, '{"delivered":true}');
    const body = expectProblem(res, 404);
    expect(res.body).not.toMatch(/uuid|SELECT|syntax/i);
    expect(body.title).toBe('Not found');
    expect((await stored())[0].delivered).toBe(false);
  });

  it.each([
    ['invalid JSON', '{"delivered":'],
    ['empty body', ''],
    ['array', '[true]'],
    ['string', '"delivered"'],
    ['null', 'null'],
    ['number', '1'],
    ['missing member', '{}'],
    ['non-boolean string', '{"delivered":"true"}'],
    ['non-boolean number', '{"delivered":1}'],
    ['null member', '{"delivered":null}'],
    ['extra member', '{"delivered":true,"name":"x"}'],
    ['other member only', '{"qty":3}'],
  ])('%s -> 400 problem+json and no change', async (_n, payload) => {
    await insert(1, '2026-11-20', 1);
    const res = await patch(`/orders/${id(1)}`, payload);
    expectProblem(res, 400);
    const [row] = await stored();
    expect(row.delivered).toBe(false);
    expect(row.qty).toBe(2);
    expect(row.name).toBe('name-1');
  });

  it.each([
    ['application/json', { 'content-type': 'application/json' }],
    ['text/plain', { 'content-type': 'text/plain' }],
    ['none', {}],
  ])('content type %s -> 415 with Accept-Patch and no change', async (_n, headers) => {
    await insert(1, '2026-11-20', 1);
    const res = await patch(`/orders/${id(1)}`, '{"delivered":true}', headers);
    expectProblem(res, 415);
    expect(res.headers['accept-patch']).toBe('application/merge-patch+json');
    expect((await stored())[0].delivered).toBe(false);
  });

  it.each(['GET', 'PUT', 'DELETE', 'POST'] as const)('%s /orders/{id} -> 405 with Allow: PATCH', async (method) => {
    const res = await app.inject({ method, url: `/orders/${id(1)}`, payload: method === 'GET' || method === 'DELETE' ? undefined : {} });
    expectProblem(res, 405);
    expect(res.headers.allow).toBe('PATCH');
  });

  it('a failing write -> 500 without leaking, and a real failure leaves the row unchanged', async () => {
    await insert(1, '2026-11-20', 1);
    const failing = new PgOrdersRepository({
      query: async () => {
        throw new Error('UPDATE orders SET boom at /srv/store.ts:1');
      },
    } as unknown as pg.Pool);
    const bad = buildServer({ service: createOrdersService(failing), traceId: () => 'abc' });
    const res = await bad.inject({ method: 'PATCH', url: `/orders/${id(1)}`, payload: '{"delivered":true}', headers: MP });
    const body = expectProblem(res, 500);
    expect(body.trace_id).toBe('abc');
    expect(res.body).not.toMatch(/UPDATE|boom|store\.ts/);
    expect((await stored())[0].delivered).toBe(false);
    await bad.close();
  });

  it('an unreachable store on write -> 503', async () => {
    const bad = buildServer({
      service: createOrdersService({
        listByServiceDate: async () => [],
        setDelivered: async () => {
          throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
        },
      }),
    });
    const res = await bad.inject({ method: 'PATCH', url: `/orders/${id(1)}`, payload: '{"delivered":true}', headers: MP });
    expectProblem(res, 503);
    await bad.close();
  });
});
