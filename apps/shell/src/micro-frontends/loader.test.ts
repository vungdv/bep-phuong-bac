import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createModuleLoader,
  LoadError,
  withRetryQuery,
  type LoaderEvent,
  type LoadApp,
} from './loader';

let n = 0;
const tagName = () => `x-t${++n}-app`;

function fakeRegistry() {
  const defined = new Set<string>();
  const waiters = new Map<string, Array<() => void>>();
  return {
    get: (t: string) => (defined.has(t) ? (class {} as unknown as CustomElementConstructor) : undefined),
    whenDefined: (t: string) =>
      defined.has(t)
        ? Promise.resolve(class {} as unknown as CustomElementConstructor)
        : new Promise<CustomElementConstructor>((res) => {
            waiters.set(t, [...(waiters.get(t) ?? []), () => res(class {} as unknown as CustomElementConstructor)]);
          }),
    define(t: string) {
      defined.add(t);
      (waiters.get(t) ?? []).forEach((f) => f());
    },
  };
}

function setup(opts: { importer?: (u: string) => Promise<unknown>; timeoutMs?: number } = {}) {
  const registry = fakeRegistry();
  const events: LoaderEvent[] = [];
  const log = vi.fn();
  const importer = vi.fn(opts.importer ?? (() => Promise.resolve({})));
  const loader = createModuleLoader({
    importer,
    customElementsRegistry: registry,
    timeoutMs: opts.timeoutMs ?? 10000,
    log,
    notify: (e) => events.push(e),
  });
  return { registry, events, log, importer, loader };
}

const app = (id: string, tag = tagName()): LoadApp => ({ id, url: `/${id}.js`, tag });
const route = { kind: 'route', activationId: 3 } as const;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('withRetryQuery', () => {
  it.each([
    ['./a.js', 1, './a.js?retry=1'],
    ['./a.js?x=1', 2, './a.js?x=1&retry=2'],
    ['./a.js#f', 1, './a.js?retry=1#f'],
    ['./a.js?x=1#f', 1, './a.js?x=1&retry=1#f'],
    ['https://cdn.example.com/a.js?x=1#f', 3, 'https://cdn.example.com/a.js?x=1&retry=3#f'],
    ['./a.js?retry=1&x=1', 2, './a.js?x=1&retry=2'],
    ['./a.js', 0, './a.js'],
    ['./a.js', undefined, './a.js'],
  ])('%s retry=%s -> %s', (url, retry, expected) => {
    expect(withRetryQuery(url, retry)).toBe(expected);
  });
});

describe('module loader', () => {
  it('skips import when tag already defined', async () => {
    const { registry, loader, importer, events } = setup();
    const a = app('a');
    registry.define(a.tag);
    loader.load({ app: a, uses: [], target: route });
    await vi.advanceTimersByTimeAsync(0);
    expect(importer).not.toHaveBeenCalled();
    expect(events).toEqual([{ type: 'appLoaded', target: route, appId: 'a' }]);
  });

  it('reports appLoaded with the same target on success', async () => {
    const a = app('a');
    const { registry, loader, events, importer } = setup({
      importer: async () => {
        registry.define(a.tag);
      },
    });
    loader.load({ app: a, uses: [], target: route });
    await vi.advanceTimersByTimeAsync(0);
    expect(importer).toHaveBeenCalledWith('/a.js');
    expect(events).toEqual([{ type: 'appLoaded', target: route, appId: 'a' }]);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports appFailed on import rejection', async () => {
    const { loader, events } = setup({ importer: () => Promise.reject(new Error('boom')) });
    loader.load({ app: app('a'), uses: [], target: route });
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e?.type).toBe('appFailed');
    expect(e?.target).toEqual(route);
    if (e?.type === 'appFailed') {
      expect(e.error).toBeInstanceOf(LoadError);
      expect(e.error.kind).toBe('import');
    }
  });

  it('times out when module never defines the tag', async () => {
    const { loader, events } = setup({ timeoutMs: 5000 });
    loader.load({ app: app('a'), uses: [], target: route });
    await vi.advanceTimersByTimeAsync(4999);
    expect(events).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    const e = events[0];
    expect(e?.type).toBe('appFailed');
    if (e?.type === 'appFailed') expect(e.error.kind).toBe('timeout');
  });

  it('times out when the import never resolves, leaving no timers', async () => {
    const { loader, events } = setup({ importer: () => new Promise(() => {}), timeoutMs: 3000 });
    loader.load({ app: app('a'), uses: [], target: route });
    await vi.advanceTimersByTimeAsync(3000);
    const e = events[0];
    expect(e?.type).toBe('appFailed');
    if (e?.type === 'appFailed') expect(e.error.kind).toBe('timeout');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('catches and logs a throwing notify', async () => {
    const log = vi.fn();
    const loader = createModuleLoader({
      importer: () => Promise.resolve({}),
      customElementsRegistry: { get: () => class {} as unknown as CustomElementConstructor, whenDefined: () => Promise.resolve(class {} as unknown as CustomElementConstructor) },
      log,
      notify: () => {
        throw new Error('bad');
      },
    });
    loader.load({ app: app('a'), uses: [], target: route });
    await vi.advanceTimersByTimeAsync(0);
    expect(log).toHaveBeenCalledWith('error', 'notifyFailed', expect.objectContaining({ appId: 'a' }));
  });

  it('times out when module defines a different tag', async () => {
    const a = app('a');
    const { registry, loader, events } = setup({
      importer: async () => registry.define(tagName()),
    });
    loader.load({ app: a, uses: [], target: route });
    await vi.advanceTimersByTimeAsync(10000);
    expect(events[0]?.type).toBe('appFailed');
  });

  it('appends retry cache-buster to main app and uses', async () => {
    const { loader, importer } = setup();
    loader.load({ app: app('a'), uses: [app('b')], target: route, retry: 2 });
    await vi.advanceTimersByTimeAsync(0);
    expect(importer).toHaveBeenCalledWith('/a.js?retry=2');
    expect(importer).toHaveBeenCalledWith('/b.js?retry=2');
  });

  it('loads app and uses in parallel', async () => {
    const resolvers: Array<() => void> = [];
    const { loader, importer } = setup({
      importer: () => new Promise((res) => resolvers.push(() => res({}))),
    });
    loader.load({ app: app('a'), uses: [app('b'), app('c')], target: route });
    expect(importer).toHaveBeenCalledTimes(3);
    expect(resolvers).toHaveLength(3);
  });

  it('child failure is non-fatal: parent loaded, child failed with child target, warn logged', async () => {
    const a = app('a');
    const b = app('b');
    const { registry, loader, events, log } = setup({
      importer: async (url) => {
        if (url === '/b.js') throw new Error('nope');
        registry.define(a.tag);
      },
    });
    loader.load({ app: a, uses: [b], target: route });
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toContainEqual({ type: 'appLoaded', target: route, appId: 'a' });
    const failed = events.find((e) => e.type === 'appFailed');
    expect(failed?.target).toEqual({ kind: 'child', parentId: 'a' });
    expect(failed?.appId).toBe('b');
    expect(log).toHaveBeenCalledWith('warn', 'appLoadFailed', expect.objectContaining({ appId: 'b' }));
  });

  it('uses is not transitive: loads only what it is given', async () => {
    const { loader, importer } = setup();
    loader.load({ app: app('a'), uses: [app('b')], target: route });
    await vi.advanceTimersByTimeAsync(0);
    expect(importer).toHaveBeenCalledTimes(2);
  });
});
