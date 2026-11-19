import { describe, expect, it, vi } from 'vitest';
import { HostMediator } from './host-mediator';
import { initialState } from './transition';
import type { HostCommand, HostEvent, ResolvedConfig } from './types';

const config: ResolvedConfig = {
  apps: [{ id: 'a', uses: [] }],
  routes: [{ path: '#/a', app: 'a' }, { path: '#/b', app: 'a' }],
};

function make(dispatch: (c: HostCommand) => void) {
  const log = vi.fn();
  const m = new HostMediator({ initialState, dispatch, log });
  return { m, log };
}

describe('HostMediator', () => {
  it('stores state and dispatches commands', () => {
    const seen: HostCommand[] = [];
    const { m } = make((c) => seen.push(c));
    m.notify({ type: 'started' });
    expect(seen.map((c) => c.kind)).toEqual(['outlet.showLoading', 'config.load']);
    m.notify({ type: 'configLoaded', config, lang: 'vi' });
    expect(m.getState().lang).toBe('vi');
    expect(m.getState().phase).toBe('home');
  });

  it('queues re-entrant events and keeps order', () => {
    const order: string[] = [];
    let m!: HostMediator;
    const dispatch = (c: HostCommand) => {
      order.push(`start:${c.kind}`);
      if (c.kind === 'outlet.showHome') {
        m.notify({ type: 'routeChanged', hash: '#/a' });
        order.push('after-notify');
      }
      order.push(`end:${c.kind}`);
    };
    ({ m } = make(dispatch));
    m.notify({ type: 'configLoaded', config, lang: 'vi' } as HostEvent);
    m.notify({ type: 'routeChanged', hash: '#/zzz' });
    m.notify({ type: 'routeChanged', hash: '#/' });
    // Re-entrant event must run only after the current command batch finished.
    const i = order.indexOf('after-notify');
    expect(order[i + 1]).toBe('end:outlet.showHome');
    expect(order.indexOf('start:loader.load')).toBeGreaterThan(i);
    expect(m.getState().activeApp).toBe('a');
  });

  it('isolates a throwing command: logs and continues with later commands and events', () => {
    const seen: string[] = [];
    const { m, log } = make((c) => {
      seen.push(c.kind);
      if (c.kind === 'outlet.showLoading') throw new Error('boom');
    });
    m.notify({ type: 'started' });
    expect(seen).toEqual(['outlet.showLoading', 'config.load']);
    expect(log).toHaveBeenCalledWith('error', 'command.threw', expect.objectContaining({ command: 'outlet.showLoading' }));
    m.notify({ type: 'configFailed', errors: ['x'] });
    expect(m.getState().phase).toBe('fatalError');
  });

  it('a throwing dispatch inside a drain does not drop queued events', () => {
    const seen: string[] = [];
    let m!: HostMediator;
    ({ m } = make((c) => {
      seen.push(c.kind);
      if (c.kind === 'outlet.showHome') {
        m.notify({ type: 'routeChanged', hash: '#/nope' });
        throw new Error('x');
      }
    }));
    m.notify({ type: 'configLoaded', config, lang: 'vi' });
    expect(seen).toContain('outlet.showNotFound');
    expect(m.getState().phase).toBe('notFound');
  });
});
