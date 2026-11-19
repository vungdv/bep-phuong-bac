import { describe, expect, it, vi } from 'vitest';
import { createLogger } from './logger';

const now = () => new Date('2026-11-19T00:00:00.000Z');

describe('logger', () => {
  it('writes one JSON line for warn with fields passed through', () => {
    const warn = vi.fn();
    createLogger({ warn, error: vi.fn(), now }).log('warn', 'navigate.ignored', {
      appId: 'orders',
      target: 'route',
      activationId: 2,
      route: '#/order',
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toEqual({
      level: 'warn',
      event: 'navigate.ignored',
      ts: '2026-11-19T00:00:00.000Z',
      appId: 'orders',
      target: 'route',
      activationId: 2,
      route: '#/order',
    });
  });

  it('writes errors to the error sink', () => {
    const warn = vi.fn();
    const error = vi.fn();
    createLogger({ warn, error, now }).log('error', 'route.failed', { error: 'boom' });
    expect(warn).not.toHaveBeenCalled();
    expect(JSON.parse(error.mock.calls[0]?.[0] as string)).toMatchObject({
      level: 'error',
      event: 'route.failed',
      error: 'boom',
    });
  });

  it('drops info and debug by default', () => {
    const warn = vi.fn();
    const error = vi.fn();
    const logger = createLogger({ warn, error });
    logger.log('info', 'x');
    logger.log('debug', 'y');
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('emits info/debug only when a debug sink is given', () => {
    const debug = vi.fn();
    createLogger({ debug, now }).log('info', 'x', { a: 1 });
    expect(JSON.parse(debug.mock.calls[0]?.[0] as string)).toMatchObject({ level: 'info', a: 1 });
  });

  it('survives unserializable fields', () => {
    const warn = vi.fn();
    const cyc: Record<string, unknown> = {};
    cyc['self'] = cyc;
    createLogger({ warn }).log('warn', 'e', { cyc });
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toMatchObject({ event: 'e', unserializable: true });
  });

  it('does not let fields clobber level, event or ts', () => {
    const warn = vi.fn();
    createLogger({ warn, now }).log('warn', 'real', { level: 'x', event: 'y', ts: 'z' });
    expect(JSON.parse(warn.mock.calls[0]?.[0] as string)).toMatchObject({
      level: 'warn',
      event: 'real',
      ts: '2026-11-19T00:00:00.000Z',
    });
  });
});
