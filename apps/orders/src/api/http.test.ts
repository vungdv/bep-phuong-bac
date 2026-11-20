import { describe, expect, it } from 'vitest';
import { HttpClient, HttpError } from './http';
import { empty, fakeFetch, json } from './fake-fetch';

const noSleep = async () => {};

describe('HttpClient', () => {
  it('sends bearer token and JSON body, parses JSON', async () => {
    const f = fakeFetch(() => json({ ok: 1 }));
    const c = new HttpClient({ fetch: f.fetch, getToken: async () => 'tok' });
    expect(await c.request('POST', 'http://x/a', { body: { a: 1 } })).toEqual({ ok: 1 });
    const h = f.calls[0]!.init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer tok');
    expect(h['Content-Type']).toBe('application/json');
    expect(f.calls[0]!.body).toEqual({ a: 1 });
  });

  it('omits Authorization without a token', async () => {
    const f = fakeFetch(() => json({}));
    await new HttpClient({ fetch: f.fetch }).request('GET', 'http://x/a');
    expect((f.calls[0]!.init.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it('retries idempotent calls with growing backoff, then throws HttpError', async () => {
    const f = fakeFetch(() => empty(503));
    const delays: number[] = [];
    const c = new HttpClient({ fetch: f.fetch, sleep: async (ms) => void delays.push(ms), random: () => 0.5 });
    await expect(c.request('GET', 'http://x', { idempotent: true })).rejects.toMatchObject({ status: 503 });
    expect(f.calls).toHaveLength(3);
    expect(delays).toEqual([200, 400]);
  });

  it('recovers when a retry succeeds', async () => {
    const f = fakeFetch(() => empty(429), () => json({ v: 2 }));
    const c = new HttpClient({ fetch: f.fetch, sleep: noSleep });
    expect(await c.request('GET', 'http://x', { idempotent: true })).toEqual({ v: 2 });
  });

  it('does not retry non-idempotent calls or 4xx', async () => {
    const f = fakeFetch(() => empty(500));
    const c = new HttpClient({ fetch: f.fetch, sleep: noSleep });
    await expect(c.request('POST', 'http://x', { body: {} })).rejects.toMatchObject({ status: 500 });
    expect(f.calls).toHaveLength(1);
    const g = fakeFetch(() => empty(404));
    await expect(new HttpClient({ fetch: g.fetch, sleep: noSleep }).request('GET', 'http://x', { idempotent: true })).rejects.toMatchObject({ status: 404 });
    expect(g.calls).toHaveLength(1);
  });

  it('maps network failures to HttpError status 0', async () => {
    const f = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const err = (await new HttpClient({ fetch: f, sleep: noSleep }).request('GET', 'http://x').then(() => undefined, (e: HttpError) => e))!;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.status).toBe(0);
  });

  it('aborts after the timeout', async () => {
    const f = ((_u: string, init: RequestInit) =>
      new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))))) as unknown as typeof fetch;
    const err = (await new HttpClient({ fetch: f, timeoutMs: 20 }).request('GET', 'http://x').then(() => undefined, (e: HttpError) => e))!;
    expect(err).toBeInstanceOf(HttpError);
    expect(err.message).toContain('timed out');
  });
});
