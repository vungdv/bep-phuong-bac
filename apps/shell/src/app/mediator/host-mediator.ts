import { transition } from './transition';
import type { HostCommand, HostEvent, HostState } from './types';

export interface HostMediatorOptions {
  readonly initialState: HostState;
  /** Colleague dispatch: routes each command to a method that returns nothing. */
  readonly dispatch: (command: HostCommand) => void;
  /** Used for caught command errors. */
  readonly log: (level: 'error', event: string, fields: Record<string, unknown>) => void;
}

/** Stores state, runs the pure transition, dispatches commands, queues re-entrant events. */
export class HostMediator {
  private state: HostState;
  private readonly queue: HostEvent[] = [];
  private draining = false;

  constructor(private readonly opts: HostMediatorOptions) {
    this.state = opts.initialState;
  }

  getState(): HostState {
    return this.state;
  }

  notify(event: HostEvent): void {
    this.queue.push(event);
    if (this.draining) return;
    this.draining = true;
    try {
      for (let e = this.queue.shift(); e; e = this.queue.shift()) this.handle(e);
    } finally {
      this.draining = false;
    }
  }

  private handle(event: HostEvent): void {
    let result;
    try {
      result = transition(this.state, event);
    } catch (error) {
      this.opts.log('error', 'transition.threw', { event: event.type, error: String(error) });
      return;
    }
    this.state = result.state;
    for (const command of result.commands) {
      try {
        this.opts.dispatch(command);
      } catch (error) {
        this.opts.log('error', 'command.threw', { command: command.kind, error: String(error) });
      }
    }
  }
}
