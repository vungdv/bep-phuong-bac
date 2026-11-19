import type { Order } from '../domain/order';
import { NotFoundError, type OrdersApi } from './orders-api';

export interface Clock {
  now(): number;
}

const pad = (n: number): string => String(n).padStart(2, '0');

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isoWithOffset(d: Date): string {
  const off = -d.getTimezoneOffset();
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

const SEED_ROWS: ReadonlyArray<readonly [string, number, string, number, number]> = [
  // name, qty, message, hour, minute
  ['Nguyễn Văn An', 2, 'Ít cay, giao trước 11h', 8, 5],
  ['Trần Thị Bích', 1, '', 8, 40],
  ['Lê Hoàng Nam', 4, 'Thêm rau sống', 9, 15],
  ['Phạm Thu Hà', 3, '', 10, 2],
  ['Võ Minh Tuấn', 5, 'Gọi trước khi đến', 10, 48],
  ['Đặng Ngọc Lan', 1, 'Không hành', 11, 30],
];

function buildSeed(clock: Clock): Order[] {
  const base = new Date(clock.now());
  const orders: Order[] = [];
  for (const [offset, label] of [[-1, 'y'], [0, 't'], [1, 'n']] as const) {
    const day = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offset);
    const serviceDate = dayKey(day);
    SEED_ROWS.forEach(([name, qty, message, h, m], i) => {
      const created = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0);
      orders.push({
        id: `seed-${label}-${i + 1}`,
        no: i + 1,
        name,
        qty,
        message,
        createdAt: isoWithOffset(created),
        serviceDate,
        // F36: only some of yesterday's orders are delivered
        delivered: offset === -1 && i % 2 === 0,
      });
    });
  }
  return orders;
}

export class LocalStorageOrdersApi implements OrdersApi {
  private orders: Order[];

  constructor(
    private readonly storage: Storage,
    private readonly key: string,
    private readonly clock: Clock = Date,
  ) {
    this.orders = this.load();
  }

  private warn(reason: string, error?: unknown): void {
    console.warn({
      level: 'warn',
      component: 'LocalStorageOrdersApi',
      event: 'storage_fallback',
      reason,
      key: this.key,
      error: error instanceof Error ? error.message : error === undefined ? undefined : String(error),
    });
  }

  private load(): Order[] {
    let raw: string | null;
    try {
      raw = this.storage.getItem(this.key);
    } catch (e) {
      this.warn('read_failed', e);
      return buildSeed(this.clock);
    }
    if (raw === null) {
      const seed = buildSeed(this.clock);
      try {
        this.storage.setItem(this.key, JSON.stringify(seed));
      } catch (e) {
        this.warn('seed_persist_failed', e);
      }
      return seed;
    }
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new TypeError('stored orders is not an array');
      return parsed as Order[];
    } catch (e) {
      this.warn('parse_failed', e);
      return buildSeed(this.clock);
    }
  }

  async listOrders(serviceDate: string): Promise<Order[]> {
    return this.orders
      .filter((o) => o.serviceDate === serviceDate)
      .sort((a, b) => a.no - b.no)
      .map((o) => ({ ...o }));
  }

  async setDelivered(id: string, delivered: boolean): Promise<Order> {
    const index = this.orders.findIndex((o) => o.id === id);
    if (index < 0) throw new NotFoundError(id);
    const updated: Order = { ...this.orders[index]!, delivered };
    const next = this.orders.map((o, i) => (i === index ? updated : o));
    this.storage.setItem(this.key, JSON.stringify(next)); // throws -> reject, state unchanged
    this.orders = next;
    return { ...updated };
  }
}
