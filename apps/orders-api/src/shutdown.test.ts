import { describe, expect, it } from 'vitest';
import { createShutdown } from './shutdown.js';

describe('createShutdown', () => {
  it('drains the server before closing the pool, once', async () => {
    const calls: string[] = [];
    const sd = createShutdown({
      closeServer: async () => void calls.push('server'),
      closePool: async () => void calls.push('pool'),
    });
    expect(await Promise.all([sd('SIGTERM'), sd('SIGINT')])).toEqual([0, 0]);
    expect(calls).toEqual(['server', 'pool']);
  });
  it('still closes the pool and returns 1 when the server close fails', async () => {
    const calls: string[] = [];
    const sd = createShutdown({
      closeServer: async () => { throw new Error('x'); },
      closePool: async () => void calls.push('pool'),
    });
    expect(await sd('SIGTERM')).toBe(1);
    expect(calls).toEqual(['pool']);
  });
});
