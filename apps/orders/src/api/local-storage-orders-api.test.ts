import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalStorageOrdersApi } from './local-storage-orders-api';
import { NotFoundError } from './orders-api';

class FakeStorage implements Storage {
  data = new Map<string, string>();
  failGet = false;
  failSet = false;
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(k: string) {
    if (this.failGet) throw new Error('get denied');
    return this.data.get(k) ?? null;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
  setItem(k: string, v: string) {
    if (this.failSet) throw new Error('quota');
    this.data.set(k, v);
  }
}

const KEY = 'bpb.orders';
const NOW = new Date(2026, 10, 20, 12, 0, 0); // local noon, 2026-11-20
const clock = { now: () => NOW.getTime() };
const TODAY = '2026-11-20';
const YESTERDAY = '2026-11-19';
const TOMORROW = '2026-11-21';

const order = (id: string, no: number, serviceDate: string) => ({
  id,
  no,
  name: `N${no}`,
  qty: 1,
  message: '',
  createdAt: '2026-11-20T08:00:00+07:00',
  serviceDate,
  delivered: false,
});

afterEach(() => vi.restoreAllMocks());

describe('LocalStorageOrdersApi seed (F22, F36)', () => {
  it('seeds yesterday, today and tomorrow and persists once', async () => {
    const s = new FakeStorage();
    const api = new LocalStorageOrdersApi(s, KEY, clock);
    for (const day of [YESTERDAY, TODAY, TOMORROW]) {
      const list = await api.listOrders(day);
      expect(list.length).toBeGreaterThan(1);
      expect(list.map((o) => o.no)).toEqual(list.map((_, i) => i + 1));
      for (const o of list) {
        expect(Number.isInteger(o.qty) && o.qty > 0).toBe(true);
        expect(o.createdAt).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
        expect(o.createdAt.startsWith(day)).toBe(true);
      }
    }
    const stored = s.getItem(KEY);
    expect(stored).not.toBeNull();
    new LocalStorageOrdersApi(s, KEY, { now: () => NOW.getTime() + 86_400_000 * 30 });
    expect(s.getItem(KEY)).toBe(stored);
  });

  it('seed has ids unique, empty messages present, delivered only on some of yesterday', async () => {
    const api = new LocalStorageOrdersApi(new FakeStorage(), KEY, clock);
    const y = await api.listOrders(YESTERDAY);
    const t = await api.listOrders(TODAY);
    const n = await api.listOrders(TOMORROW);
    const all = [...y, ...t, ...n];
    expect(new Set(all.map((o) => o.id)).size).toBe(all.length);
    expect(all.some((o) => o.message === '')).toBe(true);
    expect(y.some((o) => o.delivered)).toBe(true);
    expect(y.some((o) => !o.delivered)).toBe(true);
    expect([...t, ...n].every((o) => !o.delivered)).toBe(true);
  });
});

describe('LocalStorageOrdersApi read (F4, F23, F25)', () => {
  it('uses stored orders unchanged, filters by day, sorts by no', async () => {
    const s = new FakeStorage();
    s.setItem(KEY, JSON.stringify([order('c', 3, TODAY), order('a', 1, TODAY), order('x', 1, YESTERDAY), order('b', 2, TODAY)]));
    const api = new LocalStorageOrdersApi(s, KEY, clock);
    expect((await api.listOrders(TODAY)).map((o) => o.id)).toEqual(['a', 'b', 'c']);
    expect((await api.listOrders(YESTERDAY)).map((o) => o.id)).toEqual(['x']);
  });

  it('returns [] for a day without orders', async () => {
    const api = new LocalStorageOrdersApi(new FakeStorage(), KEY, clock);
    expect(await api.listOrders('2020-01-01')).toEqual([]);
  });

  it('never reseeds an empty stored list', async () => {
    const s = new FakeStorage();
    s.setItem(KEY, '[]');
    const api = new LocalStorageOrdersApi(s, KEY, clock);
    expect(await api.listOrders(TODAY)).toEqual([]);
    expect(s.getItem(KEY)).toBe('[]');
  });
});

describe('LocalStorageOrdersApi fallback (F24)', () => {
  it('serves an in-memory seed and warns on corrupt JSON', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = new FakeStorage();
    s.setItem(KEY, '{not json');
    const api = new LocalStorageOrdersApi(s, KEY, clock);
    expect((await api.listOrders(TODAY)).length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatchObject({ level: 'warn', reason: 'parse_failed' });
    expect(s.getItem(KEY)).toBe('{not json');
  });

  it('serves an in-memory seed when stored JSON is not an array', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = new FakeStorage();
    s.setItem(KEY, '{"a":1}');
    const api = new LocalStorageOrdersApi(s, KEY, clock);
    expect((await api.listOrders(TODAY)).length).toBeGreaterThan(0);
  });

  it('survives a storage that throws on read and write', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = new FakeStorage();
    s.failGet = true;
    s.failSet = true;
    const api = new LocalStorageOrdersApi(s, KEY, clock);
    expect((await api.listOrders(TODAY)).length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalled();
  });

  it('survives a storage that throws only when seeding', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const s = new FakeStorage();
    s.failSet = true;
    const api = new LocalStorageOrdersApi(s, KEY, clock);
    expect((await api.listOrders(TODAY)).length).toBeGreaterThan(0);
    expect(warn).toHaveBeenCalled();
  });
});

describe('LocalStorageOrdersApi.setDelivered (F33-F35)', () => {
  it('sets and clears the flag, returns the updated order and persists', async () => {
    const s = new FakeStorage();
    const api = new LocalStorageOrdersApi(s, KEY, clock);
    const [first] = await api.listOrders(TODAY);
    const on = await api.setDelivered(first!.id, true);
    expect(on).toEqual({ ...first, delivered: true });
    expect((await api.listOrders(TODAY))[0]!.delivered).toBe(true);
    const off = await api.setDelivered(first!.id, false);
    expect(off.delivered).toBe(false);
    expect((await api.listOrders(TODAY))[0]!.delivered).toBe(false);
  });

  it('persists across a new instance on the same storage', async () => {
    const s = new FakeStorage();
    const a = new LocalStorageOrdersApi(s, KEY, clock);
    const [first] = await a.listOrders(TODAY);
    await a.setDelivered(first!.id, true);
    const b = new LocalStorageOrdersApi(s, KEY, clock);
    expect((await b.listOrders(TODAY))[0]!.delivered).toBe(true);
  });

  it('rejects an unknown id with NotFoundError', async () => {
    const api = new LocalStorageOrdersApi(new FakeStorage(), KEY, clock);
    await expect(api.setDelivered('nope', true)).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects and leaves storage and memory unchanged when the write throws', async () => {
    const s = new FakeStorage();
    const api = new LocalStorageOrdersApi(s, KEY, clock);
    const before = s.getItem(KEY);
    const [first] = await api.listOrders(TODAY);
    s.failSet = true;
    await expect(api.setDelivered(first!.id, true)).rejects.toThrow('quota');
    expect(s.getItem(KEY)).toBe(before);
    expect((await api.listOrders(TODAY))[0]!.delivered).toBe(false);
  });
});
