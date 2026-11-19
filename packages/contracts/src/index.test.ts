import { describe, expect, it } from 'vitest';
import {
  MF_EVENT_PREFIX,
  MF_LANGUAGE_CHANGE,
  MF_NAVIGATE,
  SHELL_OWNED_ATTRIBUTES,
} from './index';

describe('contracts constants', () => {
  it('has mf:-prefixed event names', () => {
    expect(MF_NAVIGATE).toBe('mf:navigate');
    expect(MF_LANGUAGE_CHANGE).toBe('mf:language-change');
    expect(MF_NAVIGATE.startsWith(MF_EVENT_PREFIX)).toBe(true);
  });

  it('lists shell-owned attributes', () => {
    expect([...SHELL_OWNED_ATTRIBUTES]).toEqual(['lang', 'route', 'nav', 'languages']);
  });
});
