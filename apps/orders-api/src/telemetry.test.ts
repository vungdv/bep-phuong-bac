import { SpanKind, SpanStatusCode } from '@opentelemetry/api';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { Order } from './domain/order.js';
import { buildServer } from './server.js';
import { createOrdersService } from './service/orders-service.js';
import type { OrdersRepository } from './store/orders-repository.js';
import { withTracing } from './store/traced-orders-repository.js';
import { createTestTelemetry } from './test-telemetry.js';

const ID = '00000000-0000-4000-8000-000000000001';
const SECRET_NAME = 'Nguyen Van Secret';
const SECRET_MESSAGE = 'giao truoc 9h, cong sau';
const order: Order = {
  id: ID, no: 1, name: SECRET_NAME, qty: 2, message: SECRET_MESSAGE,
  createdAt: '2026-11-20T01:02:03.000+00:00', serviceDate: '2026-11-20', delivered: false,
};
const TRACE_ID = '4bf92f3577b34da6a3ce929d0e0e4736';
const PARENT_SPAN = '00f067aa0ba902b7';
const TRACEPARENT = `00-${TRACE_ID}-${PARENT_SPAN}-01`;
const MERGE = { 'content-type': 'application/merge-patch+json' };

let app: FastifyInstance;
afterEach(() => app?.close());

function setup(repoOver: Partial<OrdersRepository> = {}) {
  const t = createTestTelemetry();
  const repo: OrdersRepository = {
    listByServiceDate: async () => [order],
    setDelivered: async (_id, delivered) => ({ ...order, delivered }),
    ...repoOver,
  };
  app = buildServer({
    service: createOrdersService(withTracing(repo, t.telemetry.tracer)),
    health: { ping: async () => true, schemaCurrent: async () => true },
    logger: t.logger,
    telemetry: t.telemetry,
  });
  return t;
}

const LIST = '/orders?serviceDate=2026-11-20&secret=abc';

describe('trace context (O1, O5)', () => {
  it('continues an incoming traceparent and echoes it', async () => {
    const t = setup();
    const res = await app.inject({ url: LIST, headers: { traceparent: TRACEPARENT } });
    const server = t.spans().find((s) => s.kind === SpanKind.SERVER)!;
    expect(server.spanContext().traceId).toBe(TRACE_ID);
    expect(server.parentSpanContext?.spanId).toBe(PARENT_SPAN);
    expect(res.headers.traceparent).toBe(`00-${TRACE_ID}-${server.spanContext().spanId}-01`);
  });

  it('starts a new trace when there is no traceparent', async () => {
    const t = setup();
    const res = await app.inject(LIST);
    const server = t.spans().find((s) => s.kind === SpanKind.SERVER)!;
    expect(server.parentSpanContext).toBeUndefined();
    expect(server.spanContext().traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(String(res.headers.traceparent)).toContain(server.spanContext().traceId);
  });

  it('ignores a malformed traceparent and starts a new trace', async () => {
    const t = setup();
    await app.inject({ url: LIST, headers: { traceparent: 'garbage' } });
    expect(t.spans().find((s) => s.kind === SpanKind.SERVER)!.parentSpanContext).toBeUndefined();
  });

  it('exposes traceparent to browsers via CORS', async () => {
    const t = createTestTelemetry();
    app = buildServer({
      service: createOrdersService({ listByServiceDate: async () => [], setDelivered: async () => null }),
      health: { ping: async () => true, schemaCurrent: async () => true },
      corsAllowedOrigins: ['https://app.example'],
      telemetry: t.telemetry,
    });
    const res = await app.inject({ url: LIST, headers: { origin: 'https://app.example' } });
    expect(res.headers['access-control-expose-headers']).toBe('traceparent');
  });
});

describe('spans (O2)', () => {
  it('records a server span named by route template with a repository child span', async () => {
    const t = setup();
    await app.inject({ url: LIST, headers: { traceparent: TRACEPARENT } });
    const spans = t.spans();
    const server = spans.find((s) => s.kind === SpanKind.SERVER)!;
    const repo = spans.find((s) => s.name === 'orders.listByServiceDate')!;
    expect(server.name).toBe('GET /orders');
    expect(server.status.code).toBe(SpanStatusCode.OK);
    expect(server.attributes['http.response.status_code']).toBe(200);
    expect(repo.parentSpanContext?.spanId).toBe(server.spanContext().spanId);
    expect(repo.spanContext().traceId).toBe(TRACE_ID);
    expect(repo.status.code).toBe(SpanStatusCode.OK);
  });

  it('names PATCH spans by template, never by the raw id', async () => {
    const t = setup();
    await app.inject({ method: 'PATCH', url: `/orders/${ID}`, headers: MERGE, payload: { delivered: true } });
    const names = t.spans().map((s) => s.name);
    expect(names).toContain('PATCH /orders/:id');
    expect(names.join(' ')).not.toContain(ID);
  });

  it('marks 5xx as ERROR and records the exception on both spans', async () => {
    const t = setup({ listByServiceDate: async () => Promise.reject(new Error('boom select *')) });
    const res = await app.inject({ url: LIST, headers: { traceparent: TRACEPARENT } });
    expect(res.statusCode).toBe(500);
    const server = t.spans().find((s) => s.kind === SpanKind.SERVER)!;
    const repo = t.spans().find((s) => s.name === 'orders.listByServiceDate')!;
    for (const span of [server, repo]) {
      expect(span.status.code).toBe(SpanStatusCode.ERROR);
      expect(span.events.some((e) => e.name === 'exception')).toBe(true);
    }
    expect(res.json().trace_id).toBe(TRACE_ID);
  });

  it('keeps 4xx as OK without exception events', async () => {
    const t = setup();
    const res = await app.inject('/orders');
    expect(res.statusCode).toBe(400);
    const server = t.spans().find((s) => s.kind === SpanKind.SERVER)!;
    expect(server.status.code).toBe(SpanStatusCode.OK);
    expect(server.events).toEqual([]);
    expect(t.spans().some((s) => s.name.startsWith('orders.'))).toBe(false);
  });

  it('names unmatched routes generically', async () => {
    const t = setup();
    await app.inject('/some/secret/path');
    expect(t.spans()[0]!.name).toBe('GET unmatched');
  });
});

describe('Problem Details trace_id (B11)', () => {
  it.each([
    ['400', { url: '/orders' }, 400],
    ['404 unknown path', { url: '/nope' }, 404],
    ['405', { method: 'POST' as const, url: '/orders' }, 405],
    ['415', { method: 'PATCH' as const, url: `/orders/${ID}`, payload: {} }, 415],
  ])('matches the server span on %s', async (_n, opts, status) => {
    const t = setup();
    const res = await app.inject({ ...opts, headers: { traceparent: TRACEPARENT } });
    expect(res.statusCode).toBe(status);
    expect(res.json().trace_id).toBe(t.spans().find((s) => s.kind === SpanKind.SERVER)!.spanContext().traceId);
  });
});

describe('access log (O3)', () => {
  it('writes one line with trace_id, span_id, method, path, status and duration_ms', async () => {
    const t = setup();
    await app.inject({ url: LIST, headers: { traceparent: TRACEPARENT } });
    const lines = t.logs();
    expect(lines).toHaveLength(1);
    const server = t.spans().find((s) => s.kind === SpanKind.SERVER)!;
    expect(lines[0]).toMatchObject({
      level: 'info',
      trace_id: TRACE_ID,
      span_id: server.spanContext().spanId,
      method: 'GET',
      path: '/orders',
      route: '/orders',
      status: 200,
    });
    expect(typeof lines[0]!.duration_ms).toBe('number');
  });

  it('never logs query strings, order contents or request bodies', async () => {
    const t = setup();
    await app.inject({ url: LIST });
    await app.inject({ method: 'PATCH', url: `/orders/${ID}`, headers: MERGE, payload: { delivered: true } });
    const raw = JSON.stringify(t.logs());
    for (const leak of ['secret=abc', 'serviceDate=', SECRET_NAME, SECRET_MESSAGE, 'delivered":true']) {
      expect(raw).not.toContain(leak);
    }
  });

  it('adds trace ids to other log lines made during a request, and logs 5xx once as error plus the access line', async () => {
    const t = setup({ listByServiceDate: async () => Promise.reject(new Error('boom')) });
    await app.inject({ url: LIST, headers: { traceparent: TRACEPARENT } });
    const lines = t.logs();
    expect(lines.map((l) => l.level)).toEqual(['error', 'info']);
    expect(lines.every((l) => l.trace_id === TRACE_ID && typeof l.span_id === 'string')).toBe(true);
    expect(lines[1]!.status).toBe(500);
  });
});

describe('metrics (O4)', () => {
  it('records request count, latency histogram and error count with route-template labels', async () => {
    const t = setup({ listByServiceDate: async () => Promise.reject(new Error('boom')) });
    await app.inject({ method: 'PATCH', url: `/orders/${ID}`, headers: MERGE, payload: { delivered: true } });
    await app.inject({ url: '/orders' });
    await app.inject({ url: LIST });
    const metrics = await t.metrics();
    const byName = (n: string) => metrics.find((m) => m.descriptor.name === n)!;
    const points = (n: string) =>
      byName(n).dataPoints.map((p) => ({ ...p.attributes, value: typeof p.value === 'number' ? p.value : (p.value as { count: number }).count }));

    expect(points('http.server.request.count')).toEqual(
      expect.arrayContaining([
        { 'http.request.method': 'PATCH', 'http.route': '/orders/:id', 'http.response.status_class': '2xx', value: 1 },
        { 'http.request.method': 'GET', 'http.route': '/orders', 'http.response.status_class': '4xx', value: 1 },
        { 'http.request.method': 'GET', 'http.route': '/orders', 'http.response.status_class': '5xx', value: 1 },
      ]),
    );
    expect(points('http.server.request.duration')).toHaveLength(3);
    expect(points('http.server.request.duration').every((p) => p.value === 1)).toBe(true);
    expect(points('http.server.error.count')).toEqual([
      { 'http.request.method': 'GET', 'http.route': '/orders', 'http.response.status_class': '5xx', value: 1 },
    ]);
    expect(JSON.stringify(metrics.map((m) => m.dataPoints.map((p) => p.attributes)))).not.toContain(ID);
  });
});
