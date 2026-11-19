import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHost } from './create-host';
import type { CreateHostOptions, Host } from './create-host';
import type { Logger } from './logger';

const BASE = 'http://localhost/host.config.json';
let n = 0;
let sfx = '';
let root: HTMLElement;
let hosts: Host[] = [];
let logs: { level: string; event: string; fields?: Record<string, unknown> }[] = [];

const tagOrders = () => `orders-${sfx}`;
const tagV2 = () => `orders-v2-${sfx}`;

interface World {
  host: Record<string, unknown>;
  routes: Record<string, unknown> | null;
  hostStatus?: number;
  hostBody?: string;
  routesStatus?: number;
  failImport: Set<string>;
  imports: string[];
}

function world(): World {
  return {
    host: {
      languages: { supported: ['vi', 'en'], fallback: 'vi' },
      home: 'orders',
      routesUrl: './routes.config.json',
      apps: {
        orders: { url: './remotes/orders.js', tag: tagOrders(), attributes: { base: 'a' } },
        'orders-v2': { url: './remotes/orders-v2.js', tag: tagV2() },
      },
    },
    routes: {
      routes: [
        { path: '#/order', app: 'orders' },
        { path: '#/orderv2', app: 'orders-v2', attributes: { variant: 'v2' } },
      ],
    },
    failImport: new Set(),
    imports: [],
  };
}

function makeFetch(w: World): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/host.config.json')) {
      if (w.hostBody !== undefined) return new Response(w.hostBody, { status: w.hostStatus ?? 200 });
      return new Response(JSON.stringify(w.host), { status: w.hostStatus ?? 200 });
    }
    if (url.endsWith('/routes.config.json')) {
      return new Response(JSON.stringify(w.routes), { status: w.routesStatus ?? 200 });
    }
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
}

function makeImporter(w: World): (url: string) => Promise<unknown> {
  const tags: Record<string, string> = {
    '/remotes/orders.js': tagOrders(),
    '/remotes/orders-v2.js': tagV2(),
  };
  return async (url) => {
    w.imports.push(url);
    const u = new URL(url);
    if (w.failImport.has(u.pathname) && !u.searchParams.has('retry')) throw new Error('boom');
    const tag = tags[u.pathname];
    if (tag && !customElements.get(tag)) customElements.define(tag, class extends HTMLElement {});
    return {};
  };
}

const logger: Logger = { log: (level, event, fields) => logs.push({ level, event, ...(fields ? { fields } : {}) }) };

function setup(w: World, extra: Partial<CreateHostOptions> = {}): Host {
  const host = createHost({
    root,
    manifestUrl: BASE,
    fetch: makeFetch(w),
    importer: makeImporter(w),
    getBrowserLanguages: () => ['vi-VN'],
    logger,
    ...extra,
  });
  hosts.push(host);
  return host;
}

const tick = () => new Promise((r) => setTimeout(r, 0));
async function setHash(hash: string) {
  window.location.hash = hash;
  await tick();
  await tick();
}
const mounted = () => root.firstElementChild as HTMLElement | null;
const view = () => root.querySelector('[data-view]')?.getAttribute('data-view');

beforeEach(async () => {
  sfx = `t${++n}`;
  root = document.createElement('div');
  root.id = 'mf-outlet';
  document.body.append(root);
  hosts = [];
  logs = [];
  await setHash('');
});
afterEach(() => {
  for (const h of hosts) h.dispose();
  root.remove();
});

describe('createHost full flow', () => {
  it('mounts the home app at #/ with lang and route, and sets <html lang>', async () => {
    const w = world();
    setup(w).start();
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tagOrders()));
    expect(mounted()?.getAttribute('lang')).toBe('vi');
    expect(mounted()?.getAttribute('route')).toBe('#/');
    expect(mounted()?.getAttribute('base')).toBe('a');
    expect(document.documentElement.getAttribute('lang')).toBe('vi');
    expect(document.querySelector('#mf-header')).toBeNull();
    expect(w.imports).toHaveLength(1);
  });

  it.each([
    [['vi-VN'], 'vi'],
    [['en-US'], 'en'],
    [['fr'], 'vi'],
    [[], 'vi'],
  ])('browser languages %j -> %s', async (langs, expected) => {
    setup(world(), { getBrowserLanguages: () => langs }).start();
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tagOrders()));
    expect(mounted()?.getAttribute('lang')).toBe(expected);
    expect(document.documentElement.getAttribute('lang')).toBe(expected);
  });

  it('/#order and /#/order mount the same app, /#orderv2 the other with variant', async () => {
    await setHash('#order');
    setup(world()).start();
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tagOrders()));
    expect(mounted()?.getAttribute('route')).toBe('#/order');
    await setHash('#/orderv2');
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tagV2()));
    expect(mounted()?.getAttribute('variant')).toBe('v2');
    await setHash('#/order');
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tagOrders()));
  });

  it('editing only the routes response changes which app a hash loads', async () => {
    await setHash('#/order');
    const w = world();
    (w.routes as { routes: { path: string; app: string }[] }).routes = [{ path: '#/order', app: 'orders-v2' }];
    setup(w).start();
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tagV2()));
  });

  it('unknown hash shows not-found with a link home', async () => {
    await setHash('#/nope');
    setup(world()).start();
    await vi.waitFor(() => expect(view()).toBe('not-found'));
    expect(root.querySelector('a')?.getAttribute('href')).toBe('#/');
  });

  it('empty manifest shows "No apps registered"', async () => {
    const w = world();
    w.host = {};
    w.routes = null;
    setup(w, { getBrowserLanguages: () => ['en'] }).start();
    await vi.waitFor(() => expect(view()).toBe('home'));
    expect(root.textContent).toContain('No apps registered');
  });

  it('sets <html lang> from the browser language while the manifest is still loading', () => {
    document.documentElement.setAttribute('lang', 'vi');
    const pending = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    setup(world(), { fetch: pending, getBrowserLanguages: () => ['en-US'] }).start();
    expect(document.documentElement.getAttribute('lang')).toBe('en');
  });

  it('ignores a load that finishes after dispose()', async () => {
    const w = world();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const base = makeImporter(w);
    const host = setup(w, {
      importer: async (url) => {
        w.imports.push(url);
        await gate;
        return base(url);
      },
    });
    host.start();
    await vi.waitFor(() => expect(w.imports.length).toBe(1));
    host.dispose();
    release();
    await tick();
    await tick();
    expect(root.childElementCount).toBe(0);
  });

  it('ignores a manifest that resolves after dispose()', async () => {
    const w = world();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const inner = makeFetch(w);
    const host = setup(w, { fetch: (async (...a: Parameters<typeof fetch>) => (await gate, inner(...a))) as typeof fetch });
    host.start();
    host.dispose();
    release();
    await tick();
    await tick();
    expect(root.childElementCount).toBe(0);
    expect(w.imports).toHaveLength(0);
  });

  it('shows a translated loading view before config loads', async () => {
    setup(world(), { getBrowserLanguages: () => ['en'] }).start();
    expect(root.querySelector('[role="status"]')?.textContent).toBe('Loading…');
  });
});

describe('failures', () => {
  it('failing home import shows error with Retry; Retry re-imports with ?retry=1 and mounts', async () => {
    const w = world();
    w.failImport.add('/remotes/orders.js');
    setup(w).start();
    await vi.waitFor(() => expect(view()).toBe('error'));
    expect(root.querySelector('[data-scope="route"]')).not.toBeNull();
    root.querySelector('button')?.click();
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tagOrders()));
    expect(w.imports.at(-1)).toContain('?retry=1');
  });

  it.each([
    ['HTTP 500', (w: World) => (w.hostStatus = 500)],
    ['bad JSON', (w: World) => (w.hostBody = '{nope')],
    ['validation errors', (w: World) => (w.host = { apps: { a: { url: './a.js' } } })],
    ['routes fetch failure', (w: World) => (w.routesStatus = 500)],
  ])('%s -> global error; Retry restarts config loading', async (_name, breakIt) => {
    const w = world();
    breakIt(w);
    setup(w).start();
    await vi.waitFor(() => expect(root.querySelector('[data-scope="global"]')).not.toBeNull());
    expect(logs.some((l) => l.event === 'config.failed')).toBe(true);
    const fixed = world();
    Object.assign(w, fixed, { hostStatus: undefined, hostBody: undefined, routesStatus: undefined });
    root.querySelector('button')?.click();
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tagOrders()));
  });
});

describe('mf:navigate', () => {
  const fire = (detail: unknown) =>
    window.dispatchEvent(new CustomEvent('mf:navigate', { detail, bubbles: true, composed: true }));

  it('valid path changes the hash and mounts the new app', async () => {
    setup(world()).start();
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tagOrders()));
    fire({ path: '#/orderv2' });
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tagV2()));
    expect(window.location.hash).toBe('#/orderv2');
  });

  it('undeclared path is ignored and logged', async () => {
    setup(world()).start();
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tagOrders()));
    fire({ path: '#/nope' });
    await tick();
    expect(window.location.hash).not.toBe('#/nope');
    expect(logs.some((l) => l.level === 'warn' && l.event === 'navigate.ignored')).toBe(true);
  });

  it.each([[undefined], [null], [{}], [{ path: 5 }], ['str']])('malformed detail %j does not throw', async (detail) => {
    setup(world()).start();
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tagOrders()));
    expect(() => fire(detail)).not.toThrow();
    expect(logs.some((l) => l.level === 'warn' && l.event === 'navigate.malformed')).toBe(true);
  });

  it('same-app navigation keeps the element and updates route', async () => {
    await setHash('#/order/1');
    setup(world()).start();
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tagOrders()));
    const el = mounted();
    await setHash('#/order/2');
    await vi.waitFor(() => expect(el?.getAttribute('route')).toBe('#/order/2'));
    expect(mounted()).toBe(el);
  });

  it('rapid switching mid-load never mounts the wrong app', async () => {
    const w = world();
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    const base = makeImporter(w);
    const importer = async (url: string) => {
      if (url.includes('orders.js')) {
        w.imports.push(url);
        await gate;
      }
      return base(url);
    };
    await setHash('#/order');
    setup(w, { importer }).start();
    await vi.waitFor(() => expect(w.imports.some((u) => u.includes('orders.js'))).toBe(true));
    await setHash('#/orderv2');
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tagV2()));
    release();
    await vi.waitFor(() => expect(logs.some((l) => l.event === 'route.result.stale')).toBe(true));
    expect(mounted()?.localName).toBe(tagV2());
  });

  it('dispose removes the listener and is idempotent', async () => {
    const host = setup(world());
    host.start();
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tagOrders()));
    host.dispose();
    expect(() => host.dispose()).not.toThrow();
    fire({ path: '#/orderv2' });
    await tick();
    expect(window.location.hash).not.toBe('#/orderv2');
    expect(root.childElementCount).toBe(0);
  });

  it('does not listen to mf:language-change', async () => {
    setup(world()).start();
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tagOrders()));
    const el = mounted();
    window.dispatchEvent(new CustomEvent('mf:language-change', { detail: { lang: 'en' }, bubbles: true, composed: true }));
    await tick();
    expect(mounted()).toBe(el);
    expect(el?.getAttribute('lang')).toBe('vi');
    expect(document.documentElement.getAttribute('lang')).toBe('vi');
  });
});
