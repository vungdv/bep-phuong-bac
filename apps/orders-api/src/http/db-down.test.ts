import type { StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../cli/migrate.js';
import { createOrdersService } from '../service/orders-service.js';
import { buildServer } from '../server.js';
import { PgOrdersRepository } from '../store/pg-orders-repository.js';
import { checkHealth, checkSchemaVersion, createPool } from '../store/pool.js';
import { startPostgres } from '../test-db.js';

let container: StartedPostgreSqlContainer;
let pool: pg.Pool;
let app: FastifyInstance;

beforeAll(async () => {
  container = await startPostgres();
  await migrate(container.getConnectionUri());
  pool = createPool(container.getConnectionUri(), { connectionTimeoutMs: 1_000 });
  app = buildServer({
    service: createOrdersService(new PgOrdersRepository(pool)),
    health: { ping: () => checkHealth(pool), schemaCurrent: () => checkSchemaVersion(pool) },
  });
  await app.ready();
});
afterAll(async () => {
  await app?.close();
  await pool?.end().catch(() => {});
  await container?.stop().catch(() => {});
});

describe('stopped database', () => {
  it('is ready while up, then /readyz and GET /orders give 503 and /healthz stays 200', async () => {
    expect((await app.inject({ url: '/readyz' })).statusCode).toBe(200);
    await container.stop();
    expect((await app.inject({ url: '/readyz' })).statusCode).toBe(503);
    const orders = await app.inject({ url: '/orders?serviceDate=2026-11-20' });
    expect(orders.statusCode).toBe(503);
    expect(String(orders.headers['content-type'])).toMatch(/^application\/problem\+json/);
    expect((await app.inject({ url: '/healthz' })).statusCode).toBe(200);
  });
});
