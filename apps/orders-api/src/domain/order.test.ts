import { describe, expect, it } from 'vitest';
import { parseServiceDate } from './order.js';

describe('parseServiceDate', () => {
  it.each(['2026-11-20', '2024-02-29', '2000-02-29', '2026-12-31', '2026-01-01'])('accepts %s', (d) => {
    expect(parseServiceDate(d)).toBe(d);
  });

  it.each([
    '2026-13-01',
    '2026-02-30',
    '2026-02-29',
    '1900-02-29',
    '2026-00-10',
    '2026-04-31',
    '20-11-2026',
    '2026-1-1',
    '2026/11/20',
    '',
    ' 2026-11-20',
    '2026-11-20 ',
    '2026-11-20\n',
    '2026-11-20T00:00:00Z',
    "2026-11-20'; DROP TABLE orders;--",
    '2026-11-20%00',
    '٢٠٢٦-١١-٢٠',
    '0000-01-01',
  ])('rejects %j', (d) => {
    expect(parseServiceDate(d)).toBeNull();
  });

  it('rejects non-strings', () => {
    expect(parseServiceDate(undefined)).toBeNull();
    expect(parseServiceDate(null)).toBeNull();
    expect(parseServiceDate(20261120)).toBeNull();
    expect(parseServiceDate(['2026-11-20'])).toBeNull();
  });
});
