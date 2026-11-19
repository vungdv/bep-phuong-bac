import { describe, expect, it, vi } from 'vitest';
import { createTranslator, messages, type MessageKey } from './messages';

describe('messages', () => {
  it('vi and en define the same keys', () => {
    expect(Object.keys(messages['en'] ?? {}).sort()).toEqual(Object.keys(messages['vi'] ?? {}).sort());
  });
  it('translates and interpolates', () => {
    const t = createTranslator({ lang: 'en', fallback: 'vi' });
    expect(t('outlet.retry')).toBe('Retry');
    expect(t('outlet.notFound.body', { hash: '#/x' })).toContain('#/x');
  });
  it('falls back to fallback language then key, warning', () => {
    const warn = vi.fn();
    const tables = { vi: { 'outlet.retry': 'Thử lại' } };
    const t = createTranslator({ lang: 'en', fallback: 'vi', warn, tables });
    expect(t('outlet.retry')).toBe('Thử lại');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(t('outlet.loading' satisfies MessageKey)).toBe('outlet.loading');
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
