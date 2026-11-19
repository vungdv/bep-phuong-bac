import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineStubChild, defineStubMaster } from '../test-fixtures/stub-remotes';
import { createHost } from './create-host';
import type { Host } from './create-host';
import type { Logger } from './logger';

const BASE = 'http://localhost/host.config.json';
let n = 0;
let sfx = '';
let root: HTMLElement;
let hosts: Host[] = [];
let logs: { level: string; event: string; fields?: Record<string, unknown> }[] = [];

const tag = (name: string) => `${name}-${sfx}`;
const logger: Logger = { log: (level, event, fields) => logs.push({ level, event, ...(fields ? { fields } : {}) }) };
const tick = () => new Promise((r) => setTimeout(r, 0));
async function setHash(hash: string) {
  window.location.hash = hash;
  await tick();
  await tick();
}
const mounted = () => root.firstElementChild as HTMLElement | null;
const view = () => root.querySelector('[data-view]')?.getAttribute('data-view');

interface World {
  apps: Record<string, Record<string, unknown>>;
  routes: { path: string; app: string }[];
  /** pathname -> function that defines the element(s) of that app */
  defs: Record<string, () => void>;
  failImport: Set<string>;
  gates: Record<string, Promise<void>>;
  imports: string[];
  started: string[];
}

/** apps: master (uses child), other (master of its own), child, grandchild (used by child). */
function world(): World {
  const w: World = {
    apps: {
      master: { url: './remotes/master.js', tag: tag('master'), uses: ['child'] },
      other: { url: './remotes/other.js', tag: tag('other') },
      child: { url: './remotes/child.js', tag: tag('child') },
    },
    routes: [
      { path: '#/stub', app: 'master' },
      { path: '#/other', app: 'other' },
    ],
    defs: {},
    failImport: new Set(),
    gates: {},
    imports: [],
    started: [],
  };
  w.defs['/remotes/child.js'] = () => defineStubChild(tag('child'));
  w.defs['/remotes/master.js'] = () => defineStubMaster({ tag: tag('master'), childTag: tag('child') });
  w.defs['/remotes/other.js'] = () => defineStubMaster({ tag: tag('other'), childTag: tag('child') });
  return w;
}

function setup(w: World, langs: readonly string[] = ['vi-VN']): Host {
  const fetchFn = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/host.config.json')) {
      return new Response(
        JSON.stringify({
          languages: { supported: ['vi', 'en'], fallback: 'vi' },
          routesUrl: './routes.config.json',
          apps: w.apps,
        }),
      );
    }
    if (url.endsWith('/routes.config.json')) return new Response(JSON.stringify({ routes: w.routes }));
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  const host = createHost({
    root,
    manifestUrl: BASE,
    fetch: fetchFn,
    importer: async (url) => {
      const pathname = new URL(url).pathname;
      w.imports.push(pathname);
      w.started.push(pathname);
      const gate = w.gates[pathname];
      if (gate) await gate;
      if (w.failImport.has(pathname)) throw new Error('boom');
      w.defs[pathname]?.();
      return {};
    },
    getBrowserLanguages: () => langs,
    logger,
  });
  hosts.push(host);
  return host;
}

function gate(): { promise: Promise<void>; release: () => void } {
  let release: () => void = () => {};
  const promise = new Promise<void>((r) => (release = r));
  return { promise, release };
}

beforeEach(async () => {
  sfx = `c${++n}`;
  root = document.createElement('div');
  root.id = 'mf-outlet';
  document.body.append(root);
  hosts = [];
  logs = [];
  await setHash('#/stub');
});
afterEach(() => {
  for (const h of hosts) h.dispose();
  root.remove();
});

describe('composition (uses) with stub remotes', () => {
  it.each([
    [['vi-VN'], 'vi'],
    [['en-US'], 'en'],
  ])('master mounts, its shadow root holds the child with lang forwarded (%j)', async (langs, expected) => {
    const w = world();
    setup(w, langs).start();
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tag('master')));
    await vi.waitFor(() => expect(mounted()?.shadowRoot?.querySelector(tag('child'))).toBeTruthy());
    const child = mounted()?.shadowRoot?.querySelector(tag('child'));
    expect(child?.getAttribute('lang')).toBe(expected);
    expect(child?.shadowRoot?.textContent).toContain(`child:${expected}`);
    expect(mounted()?.shadowRoot?.querySelector('[data-fallback]')).toBeNull();
  });

  it('requests master and child modules in parallel', async () => {
    const w = world();
    const g = gate();
    w.gates['/remotes/master.js'] = g.promise;
    w.gates['/remotes/child.js'] = g.promise;
    setup(w).start();
    await vi.waitFor(() => expect(w.started.sort()).toEqual(['/remotes/child.js', '/remotes/master.js']));
    expect(root.querySelector(tag('master'))).toBeNull(); // neither resolved yet
    g.release();
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tag('master')));
  });

  it('child import failure is non-fatal: master mounts, warn logged, fallback rendered', async () => {
    const w = world();
    w.failImport.add('/remotes/child.js');
    setup(w).start();
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tag('master')));
    await vi.waitFor(() => expect(mounted()?.shadowRoot?.querySelector('[data-fallback]')).toBeTruthy());
    expect(view()).toBeUndefined();
    expect(mounted()?.shadowRoot?.querySelector(tag('child'))).toBeNull();
    expect(
      logs.some(
        (l) => l.level === 'warn' && l.event === 'appLoadFailed' && l.fields?.['appId'] === 'child',
      ),
    ).toBe(true);
  });

  it('uses is not transitive: the grandchild is not imported', async () => {
    const w = world();
    w.apps['child'] = { ...w.apps['child'], uses: ['grandchild'] };
    w.apps['grandchild'] = { url: './remotes/grandchild.js', tag: tag('grandchild') };
    w.defs['/remotes/grandchild.js'] = () => {
      customElements.define(tag('grandchild'), class extends HTMLElement {});
    };
    setup(w).start();
    await vi.waitFor(() => expect(mounted()?.shadowRoot?.querySelector(tag('child'))).toBeTruthy());
    expect(w.imports).not.toContain('/remotes/grandchild.js');
  });

  it('mf:navigate from inside the child shadow DOM reaches window and navigates; undeclared is ignored', async () => {
    const w = world();
    setup(w).start();
    await vi.waitFor(() => expect(mounted()?.shadowRoot?.querySelector(tag('child'))).toBeTruthy());
    const child = mounted()?.shadowRoot?.querySelector(tag('child')) as HTMLElement & { navigate(p: string): void };
    child.navigate('#/nope');
    await tick();
    expect(window.location.hash).toBe('#/stub');
    expect(mounted()?.localName).toBe(tag('master'));
    expect(logs.some((l) => l.level === 'warn' && l.event === 'navigate.ignored')).toBe(true);

    const seen = vi.fn();
    window.addEventListener('mf:navigate', seen);
    child.setAttribute('nav-path', '#/other');
    child.shadowRoot?.querySelector('button')?.click();
    window.removeEventListener('mf:navigate', seen);
    expect(seen).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tag('other')));
    expect(window.location.hash).toBe('#/other');
  });

  it('same-app navigation keeps the master and child, updates route in the shadow content', async () => {
    await setHash('#/stub/1');
    setup(world()).start();
    await vi.waitFor(() => expect(mounted()?.shadowRoot?.querySelector(tag('child'))).toBeTruthy());
    const master = mounted();
    const child = master?.shadowRoot?.querySelector(tag('child'));
    expect(master?.shadowRoot?.querySelector('[data-route]')?.textContent).toBe('#/stub/1');
    await setHash('#/stub/2');
    await vi.waitFor(() => expect(master?.getAttribute('route')).toBe('#/stub/2'));
    expect(master?.shadowRoot?.querySelector('[data-route]')?.textContent).toBe('#/stub/2');
    expect(mounted()).toBe(master);
    expect(master?.shadowRoot?.querySelector(tag('child'))).toBe(child);
  });

  it('leaving the route unmounts the master and its child', async () => {
    setup(world()).start();
    await vi.waitFor(() => expect(mounted()?.shadowRoot?.querySelector(tag('child'))).toBeTruthy());
    const old = mounted() as HTMLElement;
    await setHash('#/other');
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tag('other')));
    expect(document.contains(old)).toBe(false);
  });

  it('the same app as a route master and as another master `uses` shares one definition (imported once)', async () => {
    const w = world();
    // `other` is a route master AND used by `master`.
    w.apps['master'] = { ...w.apps['master'], uses: ['child', 'other'] };
    setup(w).start();
    await vi.waitFor(() => expect(mounted()?.shadowRoot?.querySelector(tag('child'))).toBeTruthy());
    await setHash('#/other');
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tag('other')));
    expect(w.imports.filter((p) => p === '/remotes/other.js')).toHaveLength(1);
    expect(w.imports.filter((p) => p === '/remotes/child.js')).toHaveLength(1);
    expect(customElements.get(tag('other'))).toBeDefined();
  });

  it('rapid switching between two masters mid-load never mounts the wrong app', async () => {
    const w = world();
    const g = gate();
    w.gates['/remotes/master.js'] = g.promise;
    setup(w).start();
    await vi.waitFor(() => expect(w.started).toContain('/remotes/master.js'));
    await setHash('#/other');
    await vi.waitFor(() => expect(mounted()?.localName).toBe(tag('other')));
    g.release();
    await tick();
    await tick();
    await tick();
    expect(mounted()?.localName).toBe(tag('other'));
    expect(root.querySelector(tag('master'))).toBeNull();
  });

  it('a `uses` cycle in the manifest shows the global error view listing the error', async () => {
    const w = world();
    w.apps['master'] = { ...w.apps['master'], uses: ['child'] };
    w.apps['child'] = { ...w.apps['child'], uses: ['master'] };
    setup(w).start();
    await vi.waitFor(() => expect(root.querySelector('[data-scope="global"]')).toBeTruthy());
    expect(root.querySelector('[data-view="error"]')?.textContent).toContain('cycle');
    expect(w.imports).toHaveLength(0);
  });
});
