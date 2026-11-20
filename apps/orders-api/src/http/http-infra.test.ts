import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { createOrdersService } from '../service/orders-service.js';
import { buildServer } from '../server.js';
import type { HealthChecks } from './health-route.js';

const ORIGIN = 'https://app.example';
const service = createOrdersService({
  listByServiceDate: async () => [],
  setDelivered: async () => null,
} as never);
let app: FastifyInstance;

function make(health: Partial<HealthChecks> = {}, origins: string[] = [ORIGIN]) {
  app = buildServer({
    service,
    corsAllowedOrigins: origins,
    health: { ping: async () => true, schemaCurrent: async () => true, ...health },
  });
  return app;
}
afterEach(() => app?.close());

describe('CORS', () => {
  it('echoes an allowed origin with Vary', async () => {
    const res = await make().inject({ url: '/orders?serviceDate=2026-11-20', headers: { origin: ORIGIN } });
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers.vary).toContain('Origin');
  });
  it('sends no CORS headers for a disallowed origin', async () => {
    const res = await make().inject({ url: '/orders?serviceDate=2026-11-20', headers: { origin: 'https://evil.example' } });
    expect(res.statusCode).toBe(200);
    expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
  });
  it('sends no CORS headers without an origin', async () => {
    const res = await make().inject({ url: '/orders?serviceDate=2026-11-20' });
    expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
  });
  it.each(['/orders', '/orders/00000000-0000-4000-8000-000000000001'])('answers preflight on %s with 204', async (url) => {
    const res = await make().inject({
      method: 'OPTIONS',
      url,
      headers: { origin: ORIGIN, 'access-control-request-method': 'PATCH', 'access-control-request-headers': 'content-type,traceparent' },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe(ORIGIN);
    expect(res.headers['access-control-allow-methods']).toMatch(/GET/);
    expect(res.headers['access-control-allow-methods']).toMatch(/PATCH/);
    expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain('content-type');
    expect(String(res.headers['access-control-allow-headers']).toLowerCase()).toContain('traceparent');
  });
  it('preflight from a disallowed origin gets no CORS headers', async () => {
    const res = await make().inject({
      method: 'OPTIONS',
      url: '/orders',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    expect(Object.keys(res.headers).filter((h) => h.startsWith('access-control-'))).toEqual([]);
  });
});

describe('health', () => {
  it('/healthz is 200 with the store down', async () => {
    const res = await make({ ping: async () => false, schemaCurrent: async () => false }).inject({ url: '/healthz' });
    expect(res.statusCode).toBe(200);
  });
  it('/readyz is 200 when ping and schema are ok', async () => {
    expect((await make().inject({ url: '/readyz' })).statusCode).toBe(200);
  });
  it('/readyz is 503 problem when ping fails', async () => {
    const res = await make({ ping: async () => false }).inject({ url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(String(res.headers['content-type'])).toMatch(/^application\/problem\+json/);
  });
  it('/readyz is 503 when schema is behind', async () => {
    expect((await make({ schemaCurrent: async () => false }).inject({ url: '/readyz' })).statusCode).toBe(503);
  });
  it('/readyz is 503 when a check throws', async () => {
    const res = await make({ ping: async () => { throw new Error('boom'); } }).inject({ url: '/readyz' });
    expect(res.statusCode).toBe(503);
  });
});
