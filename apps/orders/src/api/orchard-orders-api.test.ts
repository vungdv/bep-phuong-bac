import { describe, expect, it } from 'vitest';
import { OrchardOrdersApi } from './orchard-orders-api';
import { NotFoundError } from './orders-api';
import { HttpError } from './http';
import { empty, fakeFetch, json, type Call } from './fake-fetch';

const BASE = 'http://backend';
const mk = (f: { fetch: typeof fetch }, token: string | undefined = 'tok') =>
  new OrchardOrdersApi({ baseUrl: BASE + '/', getToken: async () => token, fetch: f.fetch, sleep: async () => {}, timeoutMs: 50 });

const gql = (no: number, id = `id${no}`) => ({
  contentItemId: id, no, customerName: `C${no}`, qty: 2, message: null,
  serviceDate: '2026-11-21', delivered: false, createdUtc: '2026-11-20T03:20:26.6Z',
});

const item = () => ({
  ContentItemId: 'abc', ContentItemVersionId: 'v1', ContentType: 'Order', Latest: true, Published: true,
  CreatedUtc: '2026-11-20T03:20:26.6Z', Author: 'admin', DisplayText: null,
  Order: {
    No: { Value: 1 }, CustomerName: { Text: 'An' }, Qty: { Value: 2 }, Message: { Text: 'hi' },
    ServiceDate: { Text: '2026-11-21' }, Delivered: { Value: false },
  },
  TitlePart: { Title: 'x' },
});

describe('OrchardOrdersApi.listOrders', () => {
  it('sends one GraphQL query with equality filter, createdUtc ASC and variables', async () => {
    const f = fakeFetch(() => json({ data: { order: [] } }));
    await mk(f).listOrders('2026-11-21');
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0]!.url).toBe(`${BASE}/api/graphql`);
    expect(f.calls[0]!.init.method).toBe('POST');
    const { query, variables } = f.calls[0]!.body as { query: string; variables: unknown };
    expect(query).toContain('serviceDate: $day');
    expect(query).toContain('orderBy: { createdUtc: ASC }');
    expect(query).not.toContain('2026-11-21');
    expect(variables).toEqual({ day: '2026-11-21' });
  });

  it('maps scalars to Order and sorts by no', async () => {
    const f = fakeFetch(() => json({ data: { order: [gql(2), gql(1)] } }));
    const r = await mk(f).listOrders('2026-11-21');
    expect(r.map((o) => o.no)).toEqual([1, 2]);
    expect(r[0]).toEqual({
      id: 'id1', no: 1, name: 'C1', qty: 2, message: '', createdAt: '2026-11-20T03:20:26.6Z',
      serviceDate: '2026-11-21', delivered: false,
    });
  });

  it('returns [] for an empty day', async () => {
    expect(await mk(fakeFetch(() => json({ data: { order: [] } }))).listOrders('2026-11-21')).toEqual([]);
  });

  it('rejects on GraphQL errors (HTTP 200)', async () => {
    const f = fakeFetch(() => json({ errors: [{ message: 'boom' }] }));
    await expect(mk(f).listOrders('2026-11-21')).rejects.toThrow(/boom/);
  });

  it('retries 5xx with backoff then rejects with the status', async () => {
    const f = fakeFetch(() => empty(502));
    await expect(mk(f).listOrders('2026-11-21')).rejects.toMatchObject({ status: 502 });
    expect(f.calls).toHaveLength(3);
  });

  it('retries network failure then rejects HttpError', async () => {
    const f = { calls: [] as Call[], fetch: (async () => { throw new TypeError('down'); }) as typeof fetch };
    await expect(mk(f).listOrders('2026-11-21')).rejects.toBeInstanceOf(HttpError);
  });

  it('aborts on timeout', async () => {
    const f = {
      calls: [] as Call[],
      fetch: ((_u: string, init: RequestInit) =>
        new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted'))))) as unknown as typeof fetch,
    };
    await expect(mk(f).listOrders('2026-11-21')).rejects.toMatchObject({ status: 0 });
  });

  it('sends Authorization only when a token exists', async () => {
    const a = fakeFetch(() => json({ data: { order: [] } }));
    await mk(a).listOrders('2026-11-21');
    expect((a.calls[0]!.init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
    const b = fakeFetch(() => json({ data: { order: [] } }));
    await new OrchardOrdersApi({ baseUrl: BASE, getToken: async () => undefined, fetch: b.fetch }).listOrders('2026-11-21');
    expect((b.calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('rejects a malformed date key without calling the backend', async () => {
    const f = fakeFetch(() => json({}));
    await expect(mk(f).listOrders('2026-11-21") { x } #')).rejects.toThrow(RangeError);
    expect(f.calls).toHaveLength(0);
  });
});

describe('OrchardOrdersApi.setDelivered', () => {
  it('reads then posts the whole item changing only Delivered, returns mapped Order', async () => {
    const original = item();
    const f = fakeFetch(
      () => json(item()),
      (c) => json(c.body),
    );
    const r = await mk(f).setDelivered('abc', true);
    expect(f.calls.map((c) => `${c.init.method} ${c.url}`)).toEqual([`GET ${BASE}/api/content/abc`, `POST ${BASE}/api/content`]);
    const expected = structuredClone(original);
    expected.Order.Delivered.Value = true;
    expect(f.calls[1]!.body).toEqual(expected);
    expect(r).toEqual({
      id: 'abc', no: 1, name: 'An', qty: 2, message: 'hi', createdAt: '2026-11-20T03:20:26.6Z',
      serviceDate: '2026-11-21', delivered: true,
    });
  });

  it('404 on read -> NotFoundError and no write', async () => {
    const f = fakeFetch(() => empty(404));
    await expect(mk(f).setDelivered('abc', true)).rejects.toBeInstanceOf(NotFoundError);
    expect(f.calls).toHaveLength(1);
  });

  it('non-2xx on write -> HttpError with status, and the write is not retried', async () => {
    const f = fakeFetch(() => json(item()), () => empty(503));
    const err = await mk(f).setDelivered('abc', true).catch((e) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(503);
    expect(f.calls.filter((c) => c.init.method === 'POST')).toHaveLength(1);
  });

  it('read failures carry the status (after idempotent retries)', async () => {
    const f = fakeFetch(() => empty(500));
    await expect(mk(f).setDelivered('abc', true)).rejects.toMatchObject({ status: 500 });
    expect(f.calls).toHaveLength(3);
  });
});
