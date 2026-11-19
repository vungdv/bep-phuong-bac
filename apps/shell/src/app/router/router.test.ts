import type { RouteEntry } from '@bpb/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRouter, matchRoute, normalizeHash } from './router';

const routes: RouteEntry[] = [
  { path: '#/home', app: 'home' },
  { path: '#/orders', app: 'orders' },
  { path: '#/orders-archive', app: 'archive' },
  { path: '#/order', app: 'order-v1' },
  { path: '#/orderv2', app: 'order-v2' },
];

describe('normalizeHash', () => {
  it('maps empty and # to #/', () => {
    expect(normalizeHash('')).toBe('#/');
    expect(normalizeHash('#')).toBe('#/');
    expect(normalizeHash('#/')).toBe('#/');
  });
  it('treats #order and #/order as the same', () => {
    expect(normalizeHash('#order')).toBe('#/order');
    expect(normalizeHash('#/order')).toBe('#/order');
    expect(normalizeHash('/#order'.slice(1))).toBe('#/order');
  });
  it('keeps case (matching is case-sensitive)', () => {
    expect(normalizeHash('#Order')).toBe('#/Order');
  });
});

describe('matchRoute', () => {
  it('matches by segment prefix', () => {
    expect(matchRoute('#/orders', routes)?.route.app).toBe('orders');
    expect(matchRoute('#/orders/1', routes)?.route.app).toBe('orders');
    expect(matchRoute('#/orders/123/items', routes)?.route.app).toBe('orders');
  });
  it('does not match a longer sibling segment', () => {
    expect(matchRoute('#/orders-archive', [{ path: '#/orders', app: 'orders' }])).toBeUndefined();
    expect(matchRoute('#/orders-archive', routes)?.route.app).toBe('archive');
  });
  it('keeps #order and #orderv2 apart', () => {
    expect(matchRoute('#order', routes)?.route.app).toBe('order-v1');
    expect(matchRoute('#orderv2', routes)?.route.app).toBe('order-v2');
    expect(matchRoute('#orderv2', [{ path: '#/order', app: 'o' }])).toBeUndefined();
  });
  it('returns the full normalized hash', () => {
    expect(matchRoute('#order/123', routes)?.hash).toBe('#/order/123');
  });
  it('longest wins, ties pick first declared', () => {
    const r: RouteEntry[] = [
      { path: '#/a', app: 'short' },
      { path: '#/a/b', app: 'long' }, // multi-segment, only to exercise ordering logic
    ];
    expect(matchRoute('#/a/b/c', r)?.route.app).toBe('long');
    expect(matchRoute('#/a/x', r)?.route.app).toBe('short');
    const ties: RouteEntry[] = [
      { path: '#/x', app: 'first' },
      { path: '#x', app: 'second' },
    ];
    expect(matchRoute('#/x', ties)?.route.app).toBe('first');
  });
  it('is case-sensitive', () => {
    expect(matchRoute('#/Orders', routes)).toBeUndefined();
  });
  it('empty hash matches no declared route', () => {
    expect(matchRoute('', routes)).toBeUndefined();
    expect(matchRoute('#', routes)).toBeUndefined();
  });
});

describe('createRouter', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('navigate accepts #/ and declared routes, rejects others', () => {
    const router = createRouter({ routes, onRouteChanged: () => {} });
    expect(router.navigate('#/')).toBe(true);
    expect(router.navigate('')).toBe(true);
    expect(router.navigate('#/orders/5')).toBe(true);
    expect(window.location.hash).toBe('#/orders/5');
    expect(router.navigate('#/nope')).toBe(false);
    expect(window.location.hash).toBe('#/orders/5');
  });

  it('start emits current hash and hashchange fires callback; dispose removes listener', async () => {
    const onRouteChanged = vi.fn();
    window.location.hash = '#order';
    const router = createRouter({ routes, onRouteChanged });
    router.start();
    expect(onRouteChanged).toHaveBeenLastCalledWith('#/order');

    window.location.hash = '#/orders/9';
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(onRouteChanged).toHaveBeenLastCalledWith('#/orders/9');
    const calls = onRouteChanged.mock.calls.length;

    router.dispose();
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(onRouteChanged.mock.calls.length).toBe(calls);
  });

  it('works with injected deps', () => {
    let hash = '';
    let listener: (() => void) | undefined;
    const onRouteChanged = vi.fn();
    const router = createRouter({
      routes,
      onRouteChanged,
      deps: {
        getHash: () => hash,
        setHash: (h) => {
          hash = h;
          listener?.();
        },
        addHashListener: (l) => {
          listener = l;
          return () => {
            listener = undefined;
          };
        },
      },
    });
    router.start();
    expect(onRouteChanged).toHaveBeenLastCalledWith('#/');
    router.navigate('#/home');
    expect(onRouteChanged).toHaveBeenLastCalledWith('#/home');
  });
});
