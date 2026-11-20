export interface Order {
  id: string;
  no: number;
  name: string;
  qty: number;
  message: string;
  /** ISO 8601 timestamp in UTC with an explicit +00:00 offset. */
  createdAt: string;
  /** Plain calendar date, YYYY-MM-DD. */
  serviceDate: string;
  delivered: boolean;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Returns the date when it is a real calendar date in YYYY-MM-DD form, else null. Pure. */
export function parseServiceDate(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const m = DATE_RE.exec(input);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return null;
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] as number;
  return day <= days ? input : null;
}
