export interface Order {
  id: string;
  no: number;
  name: string;
  qty: number;
  message: string;
  /** ISO 8601 with offset */
  createdAt: string;
  /** YYYY-MM-DD, local day the meal is for */
  serviceDate: string;
  delivered: boolean;
}

/** Injectable clock; `Date` itself satisfies it. */
export interface Clock {
  now(): number;
}

const pad = (n: number): string => String(n).padStart(2, '0');

/** Local-day key (YYYY-MM-DD) of a Date. */
export function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** F1: current day in the browser's local time zone. */
export function todayKey(clock: Clock = Date): string {
  return toDateKey(new Date(clock.now()));
}

/** Parse a YYYY-MM-DD key into a Date at local midnight. */
export function fromDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y!, m! - 1, d!);
}
