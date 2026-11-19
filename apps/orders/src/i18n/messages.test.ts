import { describe, expect, it } from 'vitest';
import { enUS, vi as viLocale } from 'date-fns/locale';
import {
  dateFnsLocale,
  formatCreatedAt,
  formatHeaderDate,
  getMessages,
  messages,
  resolveLang,
} from './messages';

describe('resolveLang (F20)', () => {
  it.each([
    [null, 'vi'],
    [undefined, 'vi'],
    ['', 'vi'],
    ['fr', 'vi'],
    ['vi-VN', 'vi'],
    ['en-US', 'vi'],
    ['vi', 'vi'],
    ['en', 'en'],
    ['EN', 'en'],
    [' en ', 'en'],
    ['VI', 'vi'],
  ] as const)('%s -> %s', (attr, expected) => {
    expect(resolveLang(attr)).toBe(expected);
  });
});

describe('string tables (F19)', () => {
  it('have identical keys in vi and en', () => {
    expect(Object.keys(messages.vi).sort()).toEqual(Object.keys(messages.en).sort());
  });
  it('have no empty strings', () => {
    for (const lang of ['vi', 'en'] as const) {
      for (const [k, v] of Object.entries(messages[lang])) {
        if (typeof v === 'string') expect(v, k).not.toBe('');
      }
    }
  });
  it('differ between languages and vi has diacritics', () => {
    expect(getMessages('vi').noOrders).not.toBe(getMessages('en').noOrders);
    expect(getMessages('vi').colMessage).toBe('Ghi chú');
    expect(getMessages('en').colName).toBe('Name');
  });
  it('builds the per-order checkbox label from no and name', () => {
    expect(getMessages('en').deliveredLabel(3, 'An')).toContain('3');
    expect(getMessages('en').deliveredLabel(3, 'An')).toContain('An');
    expect(getMessages('vi').deliveredLabel(3, 'An')).toContain('An');
  });
});

describe('formatters (F6, F8)', () => {
  it('formatHeaderDate differs by language and names the day', () => {
    const vi = formatHeaderDate('2026-11-20', 'vi');
    const en = formatHeaderDate('2026-11-20', 'en');
    expect(vi).not.toBe(en);
    expect(en).toContain('November');
    expect(en).toContain('20');
    expect(en).toContain('2026');
    expect(vi).toContain('2026');
  });
  it('formatCreatedAt includes date and time and differs by language', () => {
    const iso = new Date(2026, 10, 20, 14, 35).toISOString();
    const vi = formatCreatedAt(iso, 'vi');
    const en = formatCreatedAt(iso, 'en');
    expect(vi).not.toBe(en);
    expect(en).toMatch(/2026/);
    expect(en).toMatch(/35/);
    expect(vi).toMatch(/35/);
  });
});

describe('dateFnsLocale', () => {
  it('maps to date-fns locales', () => {
    expect(dateFnsLocale('vi')).toBe(viLocale);
    expect(dateFnsLocale('en')).toBe(enUS);
  });
});
