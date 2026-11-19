import type { ResolvedRoute } from './types';

/** `#order`, `#/order`, `/order`, `` -> `#/order` / `#/`. */
export function normalizeHash(hash: string): string {
  const name = hash.replace(/^#/, '').replace(/^\/+/, '');
  return `#/${name}`;
}

/** Longest segment-prefix match: `#/orders` matches `#/orders` and `#/orders/1`, not `#/orders-archive`. */
export function matchRoute(
  hash: string,
  routes: readonly ResolvedRoute[],
): ResolvedRoute | undefined {
  const h = normalizeHash(hash);
  let best: ResolvedRoute | undefined;
  for (const r of routes) {
    if (h === r.path || h.startsWith(`${r.path}/`)) {
      if (!best || r.path.length > best.path.length) best = r;
    }
  }
  return best;
}
