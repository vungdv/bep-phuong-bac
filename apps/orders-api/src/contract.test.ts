import { Validator } from '@seriousme/openapi-schema-validator';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { Order } from './domain/order.js';
import { buildServer } from './server.js';
import { createOrdersService } from './service/orders-service.js';
import { createContract, OPENAPI_PATH } from './test-contract.js';
import { createTestTelemetry } from './test-telemetry.js';

const ID = '00000000-0000-4000-8000-000000000001';
const order: Order = {
  id: ID,
  no: 1,
  name: 'Chi Lan',
  qty: 2,
  message: '',
  createdAt: '2026-11-20T01:02:03.000+00:00',
  serviceDate: '2026-11-20',
  delivered: false,
};
const MERGE = { 'content-type': 'application/merge-patch+json' };
const contract = createContract();
let app: FastifyInstance;

function make(over: { list?: () => Promise<Order[]>; set?: () => Promise<Order | null>; ready?: boolean } = {}) {
  app = buildServer({
    service: createOrdersService({
      listByServiceDate: over.list ?? (async () => [order]),
      setDelivered: over.set ?? (async (_id, delivered) => ({ ...order, delivered })),
    }),
    health: { ping: async () => over.ready !== false, schemaCurrent: async () => true },
    telemetry: createTestTelemetry().telemetry,
  });
  return app;
}
afterEach(() => app?.close());

describe('openapi.yaml', () => {
  it('is a valid OpenAPI 3.1 document', async () => {
    const result = await new Validator().validate(OPENAPI_PATH);
    expect(result.errors).toBeUndefined();
    expect(result.valid).toBe(true);
  });
});

describe('responses match openapi.yaml', () => {
  it('200 with orders', async () => {
    const res = await contract.inject(make(), '/orders?serviceDate=2026-11-20');
    expect(res.statusCode).toBe(200);
  });
  it('200 empty', async () => {
    const res = await contract.inject(make({ list: async () => [] }), '/orders?serviceDate=2026-11-20');
    expect(res.json()).toEqual([]);
  });
  it('200 on PATCH', async () => {
    const res = await contract.inject(make(), { method: 'PATCH', url: `/orders/${ID}`, headers: MERGE, payload: { delivered: true } });
    expect(res.statusCode).toBe(200);
  });
  it.each(['/orders', '/orders?serviceDate=2026-02-30'])('400 on GET %s', async (url) => {
    expect((await contract.inject(make(), url)).statusCode).toBe(400);
  });
  it('400 on a bad patch body', async () => {
    const res = await contract.inject(make(), { method: 'PATCH', url: `/orders/${ID}`, headers: MERGE, payload: { delivered: 'yes' } });
    expect(res.statusCode).toBe(400);
  });
  it('400 on malformed JSON', async () => {
    const res = await contract.inject(make(), { method: 'PATCH', url: `/orders/${ID}`, headers: MERGE, payload: '{nope' });
    expect(res.statusCode).toBe(400);
  });
  it('404 for an unknown or malformed id', async () => {
    const unknown = await contract.inject(make({ set: async () => null }), { method: 'PATCH', url: `/orders/${ID}`, headers: MERGE, payload: { delivered: true } });
    expect(unknown.statusCode).toBe(404);
    const bad = await contract.inject(app, { method: 'PATCH', url: '/orders/not-a-uuid', headers: MERGE, payload: { delivered: true } });
    expect(bad.statusCode).toBe(404);
  });
  it('404 for an unknown path', async () => {
    expect((await contract.inject(make(), '/nope')).statusCode).toBe(404);
  });
  it('415 for a non merge-patch body', async () => {
    const res = await contract.inject(make(), { method: 'PATCH', url: `/orders/${ID}`, headers: { 'content-type': 'application/json' }, payload: { delivered: true } });
    expect(res.statusCode).toBe(415);
    expect(res.headers['accept-patch']).toBe('application/merge-patch+json');
  });
  it('405 with Allow on both paths', async () => {
    const a = await contract.inject(make(), { method: 'POST', url: '/orders' });
    expect([a.statusCode, a.headers.allow]).toEqual([405, 'GET, HEAD']);
    const b = await contract.inject(app, { method: 'GET', url: `/orders/${ID}` });
    expect([b.statusCode, b.headers.allow]).toEqual([405, 'PATCH']);
  });
  it('the validator rejects a 405 with a wrong Allow value', () => {
    const headers = { 'content-type': 'application/problem+json', traceparent: '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01', allow: 'PATCH' };
    const body = JSON.stringify({ type: 'about:blank', title: 'Method Not Allowed', status: 405, detail: 'x', trace_id: 'a'.repeat(32) });
    expect(() => contract.assertResponse('POST', '/orders', { statusCode: 405, headers, body })).toThrow(/Allow/);
    expect(() => contract.assertResponse('POST', '/orders', { statusCode: 405, headers: { ...headers, allow: 'GET, HEAD' }, body })).not.toThrow();
  });
  it('500 and 503 without leaking details', async () => {
    const e500 = await contract.inject(make({ list: async () => Promise.reject(new Error('select * from secrets')) }), '/orders?serviceDate=2026-11-20');
    expect(e500.statusCode).toBe(500);
    expect(e500.body).not.toContain('secrets');
    const e503 = await contract.inject(
      make({ list: async () => Promise.reject(Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })) }),
      '/orders?serviceDate=2026-11-20',
    );
    expect(e503.statusCode).toBe(503);
  });
  it('health endpoints', async () => {
    expect((await contract.inject(make(), '/healthz')).statusCode).toBe(200);
    expect((await contract.inject(app, '/readyz')).statusCode).toBe(200);
    expect((await contract.inject(make({ ready: false }), '/readyz')).statusCode).toBe(503);
  });
  it('the validator rejects a response that drifts from the spec', () => {
    const bad = { statusCode: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-cache', traceparent: '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01' }, body: JSON.stringify([{ ...order, extra: 1 }]) };
    expect(() => contract.assertResponse('GET', '/orders?serviceDate=2026-11-20', bad)).toThrow();
  });
});
