import { describe, expect, it } from 'vitest';
import { createTraceparent } from './trace';

describe('createTraceparent', () => {
  it('has the W3C format with non-zero ids', () => {
    const t = createTraceparent();
    expect(t).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    const [, traceId, parentId] = t.split('-');
    expect(traceId).not.toMatch(/^0+$/);
    expect(parentId).not.toMatch(/^0+$/);
  });
  it('uses injected randomness', () => {
    const random = (n: number) => new Uint8Array(n).fill(0xab);
    expect(createTraceparent(random)).toBe(`00-${'ab'.repeat(16)}-${'ab'.repeat(8)}-01`);
  });
  it('never emits all-zero ids', () => {
    const t = createTraceparent((n) => new Uint8Array(n));
    expect(t).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(t).not.toMatch(/-0{32}-|-0{16}-/);
  });
  it('generates different values', () => {
    expect(createTraceparent()).not.toBe(createTraceparent());
  });
});
