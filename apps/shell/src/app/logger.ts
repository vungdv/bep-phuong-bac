export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  log(level: LogLevel, event: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface LoggerOptions {
  /** Receives one JSON line per `warn` record. Defaults to `console.warn`. */
  readonly warn?: (line: string) => void;
  /** Receives one JSON line per `error` record. Defaults to `console.error`. */
  readonly error?: (line: string) => void;
  /** Receives plain `debug`/`info` records as JSON lines. Off by default: those levels are dropped. */
  readonly debug?: (line: string) => void;
  /** Clock, injectable for tests. */
  readonly now?: () => Date;
}

function serialize(record: Record<string, unknown>): string {
  try {
    return JSON.stringify(record);
  } catch {
    return JSON.stringify({ level: record['level'], event: record['event'], unserializable: true });
  }
}

/**
 * Structured logger. Emits one JSON line `{ level, event, ts, ...fields }` for `warn` and `error`
 * (fields such as `appId`, `target`, `activationId`, `route` are passed through untouched).
 * `info` and `debug` are dropped unless a `debug` sink is supplied.
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  const sinks: Record<LogLevel, ((line: string) => void) | undefined> = {
    warn: options.warn ?? ((line) => console.warn(line)),
    error: options.error ?? ((line) => console.error(line)),
    info: options.debug,
    debug: options.debug,
  };
  const now = options.now ?? (() => new Date());
  return {
    log(level, event, fields) {
      const sink = sinks[level];
      if (!sink) return;
      sink(serialize({ ...fields, level, event, ts: now().toISOString() }));
    },
  };
}
