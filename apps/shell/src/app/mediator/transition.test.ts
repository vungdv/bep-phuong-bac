import { describe, expect, it } from 'vitest';
import { matchRoute, normalizeHash } from './route-match';
import { initialState, transition } from './transition';
import type { HostCommand, HostEvent, HostState, Phase, ResolvedConfig } from './types';

const config: ResolvedConfig = {
  home: 'home-app',
  apps: [
    { id: 'home-app', uses: [] },
    { id: 'order', uses: ['ui-kit'] },
    { id: 'order-v2', uses: [] },
  ],
  routes: [
    { path: '#/order', app: 'order', attributes: { mode: 'x' } },
    { path: '#/orderv2', app: 'order-v2' },
    { path: '#/order/archive', app: 'order-v2' },
  ],
};
const noHome: ResolvedConfig = { apps: [], routes: [] };

const st = (over: Partial<HostState>): HostState => ({ ...initialState, ...over });
const ready = (over: Partial<HostState> = {}) => st({ config, lang: 'vi', ...over });
const kinds = (cmds: readonly HostCommand[]) => cmds.map((c) => c.kind);
const logs = (cmds: readonly HostCommand[]) => cmds.filter((c) => c.kind === 'log');

const states: Record<Phase, HostState> = {
  booting: st({}),
  home: ready({ phase: 'home', hash: '#/' }),
  notFound: ready({ phase: 'notFound', hash: '#/zzz' }),
  loadingApp: ready({ phase: 'loadingApp', activeApp: 'order', activationId: 3, hash: '#/order' }),
  appActive: ready({ phase: 'appActive', activeApp: 'order', activationId: 3, hash: '#/order' }),
  appError: ready({ phase: 'appError', activeApp: 'order', activationId: 3, retry: 1, hash: '#/order' }),
  fatalError: st({ phase: 'fatalError', configRetry: 0 }),
};

const events: HostEvent[] = [
  { type: 'started' },
  { type: 'configLoaded', config, lang: 'vi' },
  { type: 'configFailed', errors: ['bad'] },
  { type: 'routeChanged', hash: '#/order' },
  { type: 'appLoaded', target: { kind: 'route', activationId: 3 } },
  { type: 'appFailed', target: { kind: 'route', activationId: 3 }, error: 'boom' },
  { type: 'appLoaded', target: { kind: 'child', parentId: 'order' } },
  { type: 'appFailed', target: { kind: 'child', parentId: 'order' }, error: 'boom' },
  { type: 'retryRequested' },
  { type: 'navigateRequested', path: '#/order' },
];

describe('transition: every phase x event is total and never throws', () => {
  for (const [phase, state] of Object.entries(states)) {
    for (const event of events) {
      it(`${phase} + ${event.type}`, () => {
        const r = transition(state, event);
        expect(r.state).toBeDefined();
        expect(Array.isArray(r.commands)).toBe(true);
      });
    }
  }
});

describe('transition: phase expectations', () => {
  const run = (p: Phase, e: HostEvent) => transition(states[p], e);

  it('started in booting loads config', () => {
    expect(kinds(run('booting', { type: 'started' }).commands)).toEqual(['outlet.showLoading', 'config.load']);
  });
  it('started elsewhere is ignored', () => {
    const r = run('appActive', { type: 'started' });
    expect(r.state).toBe(states.appActive);
    expect(kinds(r.commands)).toEqual(['log']);
  });
  it('configLoaded resolves the stored hash (#/ -> home app)', () => {
    const r = run('booting', { type: 'configLoaded', config, lang: 'en' });
    expect(r.state.phase).toBe('loadingApp');
    expect(r.state.activeApp).toBe('home-app');
    expect(r.state.lang).toBe('en');
  });
  it('configLoaded uses hash seen earlier', () => {
    const s = transition(states.booting, { type: 'routeChanged', hash: '#order' }).state;
    expect(s.phase).toBe('booting');
    const r = transition(s, { type: 'configLoaded', config, lang: 'vi' });
    expect(r.state.activeApp).toBe('order');
  });
  it('configLoaded outside booting is ignored', () => {
    expect(run('home', { type: 'configLoaded', config, lang: 'vi' }).state).toBe(states.home);
  });
  it('configFailed -> fatalError with global error', () => {
    const r = run('booting', { type: 'configFailed', errors: ['x'] });
    expect(r.state.phase).toBe('fatalError');
    expect(r.commands).toContainEqual(expect.objectContaining({ kind: 'outlet.showError', scope: 'global' }));
  });
  it('configFailed outside booting is ignored', () => {
    expect(run('appActive', { type: 'configFailed', errors: ['x'] }).state).toBe(states.appActive);
  });
  it('global retry: fatalError -> booting + config.load with retry+1', () => {
    const r = run('fatalError', { type: 'retryRequested' });
    expect(r.state.phase).toBe('booting');
    expect(r.commands).toContainEqual({ kind: 'config.load', retry: 1 });
  });
  it('route retry: appError -> loadingApp, new activationId, retry+1', () => {
    const r = run('appError', { type: 'retryRequested' });
    expect(r.state.phase).toBe('loadingApp');
    expect(r.state.activationId).toBe(4);
    expect(r.commands).toContainEqual({
      kind: 'loader.load', app: 'order', uses: ['ui-kit'], target: { kind: 'route', activationId: 4 }, retry: 2,
    });
  });
  for (const p of ['booting', 'home', 'notFound', 'loadingApp', 'appActive'] as const) {
    it(`retry in ${p} is ignored`, () => {
      const r = run(p, { type: 'retryRequested' });
      expect(r.state).toBe(states[p]);
      expect(kinds(r.commands)).toEqual(['log']);
    });
  }

  it('route result for current id mounts', () => {
    const r = run('loadingApp', { type: 'appLoaded', target: { kind: 'route', activationId: 3 } });
    expect(r.state.phase).toBe('appActive');
    expect(r.commands).toEqual([
      { kind: 'outlet.mount', app: 'order', attributes: undefined, hash: '#/order' },
    ]);
  });
  it('route failure for current id -> appError with Outlet error', () => {
    const r = run('loadingApp', { type: 'appFailed', target: { kind: 'route', activationId: 3 }, error: 'boom' });
    expect(r.state.phase).toBe('appError');
    expect(r.commands).toContainEqual(expect.objectContaining({ kind: 'outlet.showError', scope: 'route' }));
  });
  it('stale route results are ignored and logged', () => {
    for (const e of [
      { type: 'appLoaded', target: { kind: 'route', activationId: 2 } },
      { type: 'appFailed', target: { kind: 'route', activationId: 2 }, error: 'x' },
    ] as HostEvent[]) {
      const r = run('loadingApp', e);
      expect(r.state).toBe(states.loadingApp);
      expect(kinds(r.commands)).toEqual(['log']);
    }
  });
  it('route result outside loadingApp is ignored even with matching id', () => {
    const r = run('appActive', { type: 'appLoaded', target: { kind: 'route', activationId: 3 } });
    expect(r.state).toBe(states.appActive);
    expect(kinds(r.commands)).toEqual(['log']);
  });
  it('child results only log, never change phase', () => {
    for (const p of Object.keys(states) as Phase[]) {
      const ok = run(p, { type: 'appLoaded', target: { kind: 'child', parentId: 'order' } });
      const bad = run(p, { type: 'appFailed', target: { kind: 'child', parentId: 'order' }, error: 'x' });
      expect(ok.state).toBe(states[p]);
      expect(bad.state).toBe(states[p]);
      expect(kinds(bad.commands)).toEqual(['log']);
      expect(logs(bad.commands)[0]).toMatchObject({ level: 'warn' });
    }
  });
});

describe('transition: routing', () => {
  const go = (s: HostState, hash: string) => transition(s, { type: 'routeChanged', hash });

  it('different app -> loadingApp with incrementing activationId', () => {
    const a = go(states.home, '#/order');
    expect(a.state.activationId).toBe(1);
    expect(a.commands).toContainEqual({
      kind: 'loader.load', app: 'order', uses: ['ui-kit'], target: { kind: 'route', activationId: 1 }, retry: 0,
    });
    const b = go(a.state, '#/orderv2');
    expect(b.state.activationId).toBe(2);
    expect(b.state.activeApp).toBe('order-v2');
  });
  it('mount carries route attributes', () => {
    const l = go(states.home, '#/order').state;
    const r = transition(l, { type: 'appLoaded', target: { kind: 'route', activationId: l.activationId } });
    expect(r.commands).toEqual([
      { kind: 'outlet.mount', app: 'order', attributes: { mode: 'x' }, hash: '#/order' },
    ]);
  });
  for (const p of ['appActive', 'loadingApp'] as const) {
    it(`same app in ${p}: updateRoute only, no reload/remount`, () => {
      const r = go(states[p], '#/order/123');
      expect(r.commands).toEqual([{ kind: 'outlet.updateRoute', hash: '#/order/123' }]);
      expect(r.state.phase).toBe(p);
      expect(r.state.activationId).toBe(3);
    });
  }
  it('same app from appError reloads (not mounted)', () => {
    expect(go(states.appError, '#/order').state.phase).toBe('loadingApp');
  });
  it('unknown hash -> notFound with raw hash', () => {
    const r = go(states.appActive, '#/nope');
    expect(r.state.phase).toBe('notFound');
    expect(r.commands).toEqual([{ kind: 'outlet.showNotFound', hash: '#/nope' }]);
    expect(r.state.activeApp).toBeNull();
  });
  it('after notFound, going back to same app reloads', () => {
    const nf = go(states.appActive, '#/nope').state;
    expect(go(nf, '#/order').state.phase).toBe('loadingApp');
  });
  it('empty hash and # mean #/ (home app)', () => {
    for (const h of ['', '#', '#/']) {
      expect(go(states.notFound, h).state.activeApp).toBe('home-app');
    }
  });
  it('#/ with no home lists routes', () => {
    const r = go(ready({ config: { ...config, home: undefined } }), '#/');
    expect(r.state.phase).toBe('home');
    expect(r.commands).toEqual([{ kind: 'outlet.showHome', routes: config.routes }]);
  });
  it('#/ with no home and no routes emits empty showHome', () => {
    const r = go(ready({ config: noHome }), '');
    expect(r.commands).toEqual([{ kind: 'outlet.showHome', routes: [] }]);
  });
  it('#order is #/order; #orderv2 is a different app', () => {
    expect(go(states.home, '#order').state.activeApp).toBe('order');
    expect(go(states.home, '#orderv2').state.activeApp).toBe('order-v2');
  });
  it('prefix: #/order-archive does not match #/order', () => {
    expect(go(states.home, '#/order-archive').state.phase).toBe('notFound');
  });
  it('longest prefix wins', () => {
    expect(go(states.home, '#/order/archive/1').state.activeApp).toBe('order-v2');
  });
  it('routeChanged before config only stores the hash', () => {
    const r = go(states.booting, '#/order');
    expect(r.commands).toEqual([]);
    expect(r.state.hash).toBe('#/order');
  });
  it('routeChanged in fatalError only stores the hash', () => {
    expect(go(states.fatalError, '#/x').commands).toEqual([]);
  });
});

describe('route-match', () => {
  it('normalizes', () => {
    expect(normalizeHash('')).toBe('#/');
    expect(normalizeHash('#')).toBe('#/');
    expect(normalizeHash('#order')).toBe('#/order');
    expect(normalizeHash('#/order')).toBe('#/order');
  });
  it('matches by segment prefix', () => {
    expect(matchRoute('#/order/1', config.routes)?.app).toBe('order');
    expect(matchRoute('#/order-archive', config.routes)).toBeUndefined();
  });
});

describe('transition: navigateRequested', () => {
  const nav = (path: string, s = states.appActive) => transition(s, { type: 'navigateRequested', path });
  it('accepts #/ and declared routes', () => {
    expect(nav('#/').commands).toEqual([{ kind: 'router.navigate', path: '#/' }]);
    expect(nav('#/order/9').commands).toEqual([{ kind: 'router.navigate', path: '#/order/9' }]);
  });
  it('ignores undeclared and malformed paths with a warning', () => {
    for (const p of ['#/undeclared', 'order', '', 'javascript:alert(1)', '#/order-archive']) {
      const r = nav(p);
      expect(kinds(r.commands)).toEqual(['log']);
      expect(r.commands[0]).toMatchObject({ level: 'warn' });
      expect(r.state).toBe(states.appActive);
    }
  });
  it('ignores while config is not loaded', () => {
    expect(kinds(nav('#/', states.booting).commands)).toEqual(['log']);
  });
});
