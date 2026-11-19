import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ConfigError, ConfigLoader, normalizeRoutePath, validateHostConfig } from './registry';

const M = 'https://example.com/app/host.config.json';
const ok = (body: unknown): Response =>
  ({ ok: true, status: 200, json: async () => body }) as Response;

function errorsOf(host: unknown, routes?: unknown): string[] {
  try {
    validateHostConfig({ host, routes, manifestUrl: M });
  } catch (e) {
    if (e instanceof ConfigError) return e.errors;
    throw e;
  }
  return [];
}
const has = (errs: string[], text: string): boolean => errs.some((e) => e.includes(text));
const apps = {
  a: { url: './a.js', tag: 'a-app' },
  b: { url: './b.js', tag: 'b-app' },
};

describe('validateHostConfig', () => {
  it('accepts an empty manifest (F6) with defaults', () => {
    const r = validateHostConfig({ host: {}, manifestUrl: M });
    expect(r).toEqual({
      languages: { supported: ['vi', 'en'], fallback: 'vi' },
      apps: {},
      routes: [],
    });
  });

  it('resolves app urls against the manifest url', () => {
    const r = validateHostConfig({
      host: { apps: { a: { url: './remotes/a.js', tag: 'a-app' }, b: { url: 'http://localhost:5174/b.js', tag: 'b-app' } } },
      manifestUrl: M,
    });
    expect(r.apps.a?.url).toBe('https://example.com/app/remotes/a.js');
    expect(r.apps.b?.url).toBe('http://localhost:5174/b.js');
  });

  it('rejects duplicate tags', () => {
    const e = errorsOf({ apps: { a: { url: 'a.js', tag: 'x-y' }, b: { url: 'b.js', tag: 'x-y' } } });
    expect(has(e, 'duplicates')).toBe(true);
  });

  it.each(['orders', 'Orders-App', 'font-face', 'annotation-xml', '1-app'])('rejects tag %s', (tag) => {
    expect(has(errorsOf({ apps: { a: { url: 'a.js', tag } } }), 'valid custom element name')).toBe(true);
  });

  it('requires url and tag', () => {
    const e = errorsOf({ apps: { a: {} } });
    expect(has(e, 'url is required')).toBe(true);
    expect(has(e, 'tag is required')).toBe(true);
  });

  it.each(['lang', 'route', 'nav', 'languages'])('rejects reserved attribute %s', (name) => {
    const e = errorsOf({ apps: { a: { url: 'a.js', tag: 'a-app', attributes: { [name]: 'x' } } } });
    expect(has(e, 'shell-owned')).toBe(true);
    expect(has(errorsOf({ apps, routesUrl: 'r.json' }, { routes: [{ path: '#/x', app: 'a', attributes: { [name]: 'x' } }] }), 'shell-owned')).toBe(true);
  });

  it('rejects bad attribute names and non-string values', () => {
    const e = errorsOf({ apps: { a: { url: 'a.js', tag: 'a-app', attributes: { Bad: 'x', ok: 1 } } } });
    expect(has(e, 'invalid attribute name')).toBe(true);
    expect(has(e, 'must be a string')).toBe(true);
  });

  it('rejects unknown and self uses', () => {
    const e = errorsOf({ apps: { a: { url: 'a.js', tag: 'a-app', uses: ['a', 'zzz'] } } });
    expect(has(e, 'itself')).toBe(true);
    expect(has(e, 'unknown app "zzz"')).toBe(true);
  });

  it('rejects uses cycles', () => {
    const e = errorsOf({
      apps: {
        a: { url: 'a.js', tag: 'a-app', uses: ['b'] },
        b: { url: 'b.js', tag: 'b-app', uses: ['c'] },
        c: { url: 'c.js', tag: 'c-app', uses: ['a'] },
      },
    });
    expect(e.filter((x) => x.includes('cycle'))).toHaveLength(1);
  });

  it('accepts non-cyclic uses (diamond)', () => {
    const r = validateHostConfig({
      host: {
        apps: {
          a: { url: 'a.js', tag: 'a-app', uses: ['b', 'c'] },
          b: { url: 'b.js', tag: 'b-app', uses: ['d'] },
          c: { url: 'c.js', tag: 'c-app', uses: ['d'] },
          d: { url: 'd.js', tag: 'd-app' },
        },
      },
      manifestUrl: M,
    });
    expect(r.apps.a?.uses).toEqual(['b', 'c']);
  });

  it('rejects home pointing at an unknown app', () => {
    expect(has(errorsOf({ apps, home: 'nope' }), 'home')).toBe(true);
    expect(validateHostConfig({ host: { apps, home: 'a' }, manifestUrl: M }).home).toBe('a');
  });

  it('drops unknown fields including layout and unknown regions', () => {
    const r = validateHostConfig({
      host: { apps, layout: { header: { app: 'zzz' }, footer: {} }, extra: 1 },
      manifestUrl: M,
    });
    expect(r).not.toHaveProperty('layout');
    expect(r).not.toHaveProperty('extra');
  });

  describe('languages', () => {
    it('rejects invalid tags and fallback outside supported', () => {
      const e = errorsOf({ languages: { supported: ['vi', 'not a tag'], fallback: 'en' } });
      expect(has(e, 'invalid language tag')).toBe(true);
      expect(has(e, 'not in languages.supported')).toBe(true);
    });
    it('accepts custom languages', () => {
      const r = validateHostConfig({ host: { languages: { supported: ['en'], fallback: 'en' } }, manifestUrl: M });
      expect(r.languages).toEqual({ supported: ['en'], fallback: 'en' });
    });
  });

  describe('routes', () => {
    const host = { apps };
    it('normalizes paths and detects #order vs #/order collision', () => {
      const e = errorsOf(host, { routes: [{ path: '#order', app: 'a' }, { path: '#/order', app: 'b' }] });
      expect(has(e, 'duplicates')).toBe(true);
      const r = validateHostConfig({ host, routes: { routes: [{ path: '#order', app: 'a' }] }, manifestUrl: M });
      expect(r.routes[0]?.path).toBe('#/order');
    });
    it('strips only one leading slash after #', () => {
      expect(has(errorsOf(host, { routes: [{ path: '#//order', app: 'a' }] }), 'invalid')).toBe(true);
      expect(has(errorsOf(host, { routes: [{ path: '//order', app: 'a' }] }), 'invalid')).toBe(true);
      expect(normalizeRoutePath('#order')).toBe('#/order');
      expect(normalizeRoutePath('#/order')).toBe('#/order');
      expect(normalizeRoutePath('/order')).toBe('#/order');
    });
    it('rejects invalid paths', () => {
      expect(has(errorsOf(host, { routes: [{ path: '#/a/b', app: 'a' }] }), 'invalid')).toBe(true);
      expect(has(errorsOf(host, { routes: [{ path: '#/Up', app: 'a' }] }), 'invalid')).toBe(true);
    });
    it('rejects unknown app', () => {
      expect(has(errorsOf(host, { routes: [{ path: '#/x', app: 'zzz' }] }), 'not an app id')).toBe(true);
    });
    it('allows several routes per app', () => {
      const r = validateHostConfig({
        host,
        routes: { routes: [{ path: '#/x', app: 'a' }, { path: '#/y', app: 'a' }] },
        manifestUrl: M,
      });
      expect(r.routes).toHaveLength(2);
    });
    it('validates label strings and maps', () => {
      const route = (label: unknown) => errorsOf(host, { routes: [{ path: '#/x', app: 'a', label }] });
      expect(route('Orders')).toEqual([]);
      expect(route({ vi: 'Đơn', en: 'Orders' })).toEqual([]);
      expect(has(route(''), 'must not be empty')).toBe(true);
      expect(has(route({ en: 'Orders' }), 'missing the fallback language "vi"')).toBe(true);
      expect(has(route({ vi: '', en: 'x' }), 'non-empty')).toBe(true);
      expect(has(route(5), 'label')).toBe(true);
    });
    it('uses the configured fallback for label check', () => {
      const h = { apps, languages: { supported: ['en'], fallback: 'en' } };
      expect(errorsOf(h, { routes: [{ path: '#/x', app: 'a', label: { en: 'x' } }] })).toEqual([]);
    });
    it('empty routes are valid', () => {
      expect(errorsOf(host, { routes: [] })).toEqual([]);
    });
  });

  it('collects errors from both files together', () => {
    const e = errorsOf(
      { apps: { a: { url: 'a.js', tag: 'bad' } }, home: 'nope' },
      { routes: [{ path: 'x/y', app: 'zzz' }] },
    );
    expect(has(e, 'custom element')).toBe(true);
    expect(has(e, 'home')).toBe(true);
    expect(has(e, 'routes[0].path')).toBe(true);
    expect(has(e, 'routes[0].app')).toBe(true);
  });
});

describe('ConfigLoader', () => {
  const host = { routesUrl: './routes.config.json', home: 'a', apps };
  const routes = { routes: [{ path: '#/order', app: 'a' }] };
  const router = (map: Record<string, unknown | Response>) =>
    vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
      const v = map[String(url)];
      if (v === undefined) return { ok: false, status: 404, json: async () => ({}) } as Response;
      return v instanceof Object && 'ok' in v ? (v as Response) : ok(v);
    });

  it('fetches both files with no-cache and resolves routesUrl against the manifest', async () => {
    const f = router({ [M]: host, 'https://example.com/app/routes.config.json': routes });
    const r = await new ConfigLoader({ fetch: f as unknown as typeof fetch }).load(M);
    expect(f.mock.calls.map((c) => String(c[0]))).toEqual([M, 'https://example.com/app/routes.config.json']);
    for (const c of f.mock.calls) expect(c[1]).toMatchObject({ cache: 'no-cache' });
    expect(r.routes).toHaveLength(1);
    expect(r.apps.a?.url).toBe('https://example.com/app/a.js');
  });

  it('passes extra headers to both fetches', async () => {
    const f = router({ [M]: host, 'https://example.com/app/routes.config.json': routes });
    await new ConfigLoader({ fetch: f as unknown as typeof fetch, headers: { traceparent: 'x' } }).load(M);
    for (const c of f.mock.calls) expect(c[1]).toMatchObject({ headers: { traceparent: 'x' } });
  });

  it('starts both fetches before either resolves when routesUrlHint is given', async () => {
    const resolvers: Array<() => void> = [];
    const started: string[] = [];
    const bodies: Record<string, unknown> = {
      [M]: host,
      'https://example.com/app/routes.config.json': routes,
    };
    const f = vi.fn((url: string | URL | Request) => {
      started.push(String(url));
      return new Promise<Response>((res) => {
        resolvers.push(() => res(ok(bodies[String(url)])));
      });
    });
    const p = new ConfigLoader({ fetch: f as unknown as typeof fetch, routesUrlHint: './routes.config.json' }).load(M);
    expect(started).toHaveLength(2);
    resolvers.forEach((r) => r());
    expect((await p).routes).toHaveLength(1);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('refetches when the hint differs from the declared routesUrl', async () => {
    const f = router({
      [M]: { ...host, routesUrl: './other.json' },
      'https://example.com/app/other.json': routes,
    });
    const r = await new ConfigLoader({ fetch: f as unknown as typeof fetch, routesUrlHint: './routes.config.json' }).load(M);
    expect(r.routes).toHaveLength(1);
  });

  it('missing routesUrl gives empty routes and ignores a failing hint', async () => {
    const f = router({ [M]: { apps } });
    const r = await new ConfigLoader({ fetch: f as unknown as typeof fetch, routesUrlHint: './routes.config.json' }).load(M);
    expect(r.routes).toEqual([]);
    const g = router({ [M]: { apps } });
    expect((await new ConfigLoader({ fetch: g as unknown as typeof fetch }).load(M)).routes).toEqual([]);
    expect(g).toHaveBeenCalledTimes(1);
  });

  it('a 404 route map is a global ConfigError even when routesUrlHint equals routesUrl', async () => {
    const f = router({ [M]: host });
    await expect(
      new ConfigLoader({ fetch: f as unknown as typeof fetch, routesUrlHint: './routes.config.json' }).load(M),
    ).rejects.toMatchObject({ name: 'ConfigError', errors: ['routes.config.json: HTTP 404'] });
  });

  it('manifest HTTP failure is a ConfigError', async () => {
    const f = router({ [M]: { ok: false, status: 500, json: async () => ({}) } as Response });
    await expect(new ConfigLoader({ fetch: f as unknown as typeof fetch }).load(M)).rejects.toMatchObject({
      name: 'ConfigError',
      errors: ['host.config.json: HTTP 500'],
    });
  });

  it('bad JSON is a ConfigError', async () => {
    const f = router({
      [M]: { ok: true, status: 200, json: async () => { throw new SyntaxError('x'); } } as unknown as Response,
    });
    await expect(new ConfigLoader({ fetch: f as unknown as typeof fetch }).load(M)).rejects.toMatchObject({
      errors: ['host.config.json: invalid JSON'],
    });
  });

  it('network rejection is a ConfigError', async () => {
    const f = vi.fn(async () => { throw new TypeError('offline'); });
    await expect(new ConfigLoader({ fetch: f as unknown as typeof fetch }).load(M)).rejects.toBeInstanceOf(ConfigError);
  });

  it('route-map HTTP failure is global', async () => {
    const f = router({ [M]: host });
    await expect(new ConfigLoader({ fetch: f as unknown as typeof fetch }).load(M)).rejects.toMatchObject({
      errors: ['routes.config.json: HTTP 404'],
    });
  });

  it('route-map bad JSON is global', async () => {
    const f = router({
      [M]: host,
      'https://example.com/app/routes.config.json': { ok: true, status: 200, json: async () => { throw new Error('x'); } } as unknown as Response,
    });
    await expect(new ConfigLoader({ fetch: f as unknown as typeof fetch }).load(M)).rejects.toMatchObject({
      errors: ['routes.config.json: invalid JSON'],
    });
  });

  it('reports validation errors from both files together', async () => {
    const f = router({
      [M]: { ...host, home: 'nope' },
      'https://example.com/app/routes.config.json': { routes: [{ path: '#/x', app: 'zzz' }] },
    });
    const err = await new ConfigLoader({ fetch: f as unknown as typeof fetch }).load(M).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ConfigError);
    expect((err as ConfigError).errors).toHaveLength(2);
  });

  it('resolves a relative manifest url against baseUrl', async () => {
    const f = router({ 'https://example.com/host.config.json': { apps } });
    const r = await new ConfigLoader({ fetch: f as unknown as typeof fetch, baseUrl: 'https://example.com/index.html' }).load('./host.config.json');
    expect(r.apps.a?.url).toBe('https://example.com/a.js');
  });
});

describe('shipped config files', () => {
  const read = (name: string): unknown =>
    JSON.parse(readFileSync(join(process.cwd(), 'public', name), 'utf8'));
  for (const [hostFile, routesFile] of [
    ['host.config.json', 'routes.config.json'],
    ['host.config.prod.json', 'routes.config.prod.json'],
  ] as const) {
    it(`${hostFile} + ${routesFile} validate`, () => {
      const r = validateHostConfig({
        host: read(hostFile),
        routes: read(routesFile),
        manifestUrl: 'https://example.com/host.config.json',
      });
      expect(r.routes.length).toBeGreaterThan(0);
      expect(Object.keys(r.apps).length).toBeGreaterThan(0);
    });
  }
  it('prod and dev route maps are identical', () => {
    expect(read('routes.config.prod.json')).toEqual(read('routes.config.json'));
  });
});
