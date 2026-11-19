import type { RouteEntry } from '@bpb/contracts';

/**
 * Normalizes a browser hash to the canonical `#/<rest>` form.
 * Strips `#` and any leading `/`: '' | '#' | '#/' -> '#/', '#order' -> '#/order'.
 * Matching is case-sensitive (route paths are lowercase per spec), so case is preserved.
 */
export function normalizeHash(hash: string): string {
  const rest = hash.replace(/^#?\/*/, '');
  return `#/${rest}`;
}

export interface RouteMatch {
  route: RouteEntry;
  /** Full normalized current hash, e.g. `#/order/123` (given to the master as `route`). */
  hash: string;
}

function isSegmentPrefix(hash: string, path: string): boolean {
  return hash === path || hash.startsWith(`${path}/`);
}

/**
 * Segment-prefix match; the longest matching route path wins, ties go to the first declared.
 * `#/orders` matches `#/orders`, `#/orders/1`, not `#/orders-archive`.
 */
export function matchRoute(hash: string, routes: readonly RouteEntry[]): RouteMatch | undefined {
  const normalized = normalizeHash(hash);
  let best: RouteEntry | undefined;
  let bestLen = -1;
  for (const route of routes) {
    const path = normalizeHash(route.path);
    if (isSegmentPrefix(normalized, path) && path.length > bestLen) {
      best = route;
      bestLen = path.length;
    }
  }
  return best ? { route: best, hash: normalized } : undefined;
}

export interface RouterDeps {
  getHash(): string;
  setHash(hash: string): void;
  /** Registers a hashchange listener; returns an unsubscribe function. */
  addHashListener(listener: () => void): () => void;
}

export interface RouterOptions {
  routes: readonly RouteEntry[];
  onRouteChanged(hash: string): void;
  deps?: RouterDeps;
}

export interface Router {
  /** Emits the current hash once and starts listening to hashchange. Idempotent. */
  start(): void;
  /** Removes the listener. */
  dispose(): void;
  /** Sets the hash if `path` is `#/` or matches a declared route; otherwise returns false. */
  navigate(path: string): boolean;
  currentHash(): string;
}

export function windowRouterDeps(win: Window = window): RouterDeps {
  return {
    getHash: () => win.location.hash,
    setHash: (hash) => {
      win.location.hash = hash;
    },
    addHashListener: (listener) => {
      win.addEventListener('hashchange', listener);
      return () => win.removeEventListener('hashchange', listener);
    },
  };
}

export function createRouter(options: RouterOptions): Router {
  const { routes, onRouteChanged } = options;
  const deps = options.deps ?? windowRouterDeps();
  let unsubscribe: (() => void) | undefined;

  const emit = (): void => onRouteChanged(normalizeHash(deps.getHash()));

  return {
    start() {
      if (unsubscribe) return;
      unsubscribe = deps.addHashListener(emit);
      emit();
    },
    dispose() {
      unsubscribe?.();
      unsubscribe = undefined;
    },
    navigate(path) {
      const target = normalizeHash(path);
      if (target !== '#/' && !matchRoute(target, routes)) return false;
      deps.setHash(target);
      return true;
    },
    currentHash: () => normalizeHash(deps.getHash()),
  };
}
