import { describe, expect, it } from 'vitest';
import { getBrowserLanguages, LANGUAGE_STORAGE_KEY, readStoredLanguage, writeStoredLanguage } from './language-store';
import { resolveLanguage } from './language-resolver';

const throwing = {
  getItem: () => {
    throw new Error('denied');
  },
  setItem: () => {
    throw new Error('denied');
  },
};

describe('language-store', () => {
  it('uses the mf:language key', () => {
    const data = new Map<string, string>();
    const storage = { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => void data.set(k, v) };
    expect(writeStoredLanguage('en', storage)).toBe(true);
    expect(data.get('mf:language')).toBe('en');
    expect(LANGUAGE_STORAGE_KEY).toBe('mf:language');
    expect(readStoredLanguage(storage)).toBe('en');
  });
  it('tolerates throwing storage', () => {
    expect(readStoredLanguage(throwing)).toBeNull();
    expect(writeStoredLanguage('en', throwing)).toBe(false);
    expect(
      resolveLanguage({ stored: readStoredLanguage(throwing), browser: ['en-US'], supported: ['vi', 'en'], fallback: 'vi' }),
    ).toBe('en');
  });
  it('tolerates unavailable storage global', () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: () => { throw new Error('blocked'); } });
    try {
      expect(readStoredLanguage()).toBeNull();
      expect(writeStoredLanguage('vi')).toBe(false);
    } finally {
      if (original) Object.defineProperty(globalThis, 'localStorage', original);
    }
  });
  it('reads browser languages, tolerating missing list', () => {
    expect(getBrowserLanguages({ languages: ['vi-VN', 'en'] })).toEqual(['vi-VN', 'en']);
    expect(getBrowserLanguages({})).toEqual([]);
    expect(getBrowserLanguages({ languages: undefined })).toEqual([]);
  });
});
