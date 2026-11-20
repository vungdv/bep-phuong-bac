export interface ShutdownTargets {
  /** Stop accepting and drain in-flight requests. */
  closeServer(): Promise<void>;
  /** Release the database pool after the server has drained. */
  closePool(): Promise<void>;
  log?: (msg: string, extra?: Record<string, unknown>) => void;
}

/** Returns an idempotent shutdown: drain server first, then close the pool. Resolves to an exit code. */
export function createShutdown({ closeServer, closePool, log = () => {} }: ShutdownTargets) {
  let running: Promise<number> | undefined;
  return (signal: string): Promise<number> => {
    running ??= (async () => {
      log('shutting down', { signal });
      let code = 0;
      try {
        await closeServer();
      } catch (err) {
        log('server close failed', { err: String(err) });
        code = 1;
      }
      try {
        await closePool();
      } catch (err) {
        log('pool close failed', { err: String(err) });
        code = 1;
      }
      return code;
    })();
    return running;
  };
}
