import { describe, expect, it } from 'vitest';
import { fromDateKey, toDateKey, todayKey } from './order';

describe('toDateKey', () => {
  it('uses the local day, not UTC (late evening)', () => {
    expect(toDateKey(new Date(2026, 10, 20, 23, 59, 59))).toBe('2026-11-20');
  });
  it('uses the local day just after midnight', () => {
    expect(toDateKey(new Date(2026, 0, 5, 0, 0, 1))).toBe('2026-01-05');
  });
  it('zero-pads month and day', () => {
    expect(toDateKey(new Date(2026, 2, 3))).toBe('2026-03-03');
  });
});

describe('todayKey', () => {
  it('derives the key from the injected clock', () => {
    const clock = { now: () => new Date(2026, 10, 20, 22, 30).getTime() };
    expect(todayKey(clock)).toBe('2026-11-20');
  });
  it('accepts Date itself as a clock', () => {
    expect(todayKey(Date)).toBe(toDateKey(new Date()));
  });
});

describe('fromDateKey', () => {
  it('parses to local midnight and round-trips', () => {
    const d = fromDateKey('2026-11-20');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(10);
    expect(d.getDate()).toBe(20);
    expect(d.getHours()).toBe(0);
    expect(toDateKey(d)).toBe('2026-11-20');
  });
});
