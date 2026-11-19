import { describe, expect, it } from 'vitest';
import { resolveLanguage } from './language-resolver';

const base = { stored: null, browser: [], supported: ['vi', 'en'], fallback: 'vi' };

describe('resolveLanguage', () => {
  it('stored choice wins over browser', () => {
    expect(resolveLanguage({ ...base, stored: 'en', browser: ['vi-VN'] })).toBe('en');
  });
  it('ignores unsupported or invalid stored value', () => {
    expect(resolveLanguage({ ...base, stored: 'fr', browser: ['en-GB'] })).toBe('en');
    expect(resolveLanguage({ ...base, stored: '!!', browser: ['en'] })).toBe('en');
  });
  it('respects browser order, skipping unsupported', () => {
    expect(resolveLanguage({ ...base, browser: ['fr', 'vi-VN'] })).toBe('vi');
    expect(resolveLanguage({ ...base, browser: ['en-US', 'vi'] })).toBe('en');
  });
  it('prefers exact match, then base language', () => {
    expect(resolveLanguage({ ...base, supported: ['en', 'en-GB'], browser: ['en-GB'] })).toBe('en-GB');
    expect(resolveLanguage({ ...base, supported: ['en', 'vi'], browser: ['en-GB'] })).toBe('en');
    expect(resolveLanguage({ ...base, browser: ['vi-VN'] })).toBe('vi');
  });
  it('falls back for empty or unsupported browser languages', () => {
    expect(resolveLanguage({ ...base, browser: [] })).toBe('vi');
    expect(resolveLanguage({ ...base, browser: ['fr', 'de'] })).toBe('vi');
  });
  it('skips invalid tags', () => {
    expect(resolveLanguage({ ...base, browser: ['not a tag', '', 'en'] })).toBe('en');
  });
});
