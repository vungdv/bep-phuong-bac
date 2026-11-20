// @vitest-environment node

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OrchardOrdersApi } from './orchard-orders-api';
import { NotFoundError } from './orders-api';

const { ORCHARD_URL, ORCHARD_CLIENT_ID, ORCHARD_CLIENT_SECRET } = process.env;
const enabled = Boolean(ORCHARD_URL && ORCHARD_CLIENT_ID && ORCHARD_CLIENT_SECRET);

/** Test-only client-credentials token; the secret never reaches the bundle. */
async function fetchToken(): Promise<string> {
  const res = await fetch(`${ORCHARD_URL}/connect/token`, {
    method: 'POST',
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: ORCHARD_CLIENT_ID!,
      client_secret: ORCHARD_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) throw new Error(`token request failed: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

/** Local day offset from today in the seed's time zone (Asia/Ho_Chi_Minh), as backend/k6/lib/config.js does. */
const dayKey = (offset: number): string =>
  new Date(Date.now() + 7 * 3600_000 + offset * 86_400_000).toISOString().slice(0, 10);

(enabled ? describe : describe.skip)('OrchardOrdersApi against a real backend', () => {
  let api: OrchardOrdersApi;
  beforeAll(async () => {
    const token = await fetchToken();
    api = new OrchardOrdersApi({ baseUrl: ORCHARD_URL!, getToken: async () => token });
  });

  it('lists a seeded day sorted by no', async () => {
    const orders = await api.listOrders(dayKey(0));
    expect(orders.length).toBeGreaterThan(0);
    expect(orders.map((o) => o.no)).toEqual([...orders.map((o) => o.no)].sort((a, b) => a - b));
    for (const o of orders) {
      expect(o.serviceDate).toBe(dayKey(0));
      expect(o.id).toBeTruthy();
      expect(o.name).toBeTruthy();
      expect(Number.isNaN(Date.parse(o.createdAt))).toBe(false);
    }
  });

  it('returns [] for a far-future day', async () => {
    expect(await api.listOrders('2999-01-01')).toEqual([]);
  });

  describe('setDelivered', () => {
    let target: { id: string; delivered: boolean; day: string };
    beforeAll(async () => {
      const first = (await api.listOrders(dayKey(1)))[0]!;
      target = { id: first.id, delivered: first.delivered, day: dayKey(1) };
    });
    afterAll(async () => {
      if (target) await api.setDelivered(target.id, target.delivered); // restore
    });

    it('persists true then false across a fresh list', async () => {
      const on = await api.setDelivered(target.id, true);
      expect(on.delivered).toBe(true);
      expect((await api.listOrders(target.day)).find((o) => o.id === target.id)?.delivered).toBe(true);
      const off = await api.setDelivered(target.id, false);
      expect(off.delivered).toBe(false);
      expect((await api.listOrders(target.day)).find((o) => o.id === target.id)?.delivered).toBe(false);
    });
  });

  it('rejects NotFoundError for an unknown, well-formed id', async () => {
    await expect(api.setDelivered('4zzzzzzzzzzzzzzzzzzzzzzzzz', true)).rejects.toBeInstanceOf(NotFoundError);
  });
});
