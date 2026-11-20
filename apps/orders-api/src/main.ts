import { loadConfig } from './config.js';
import { createOrdersService } from './service/orders-service.js';
import { buildServer } from './server.js';
import { createShutdown } from './shutdown.js';
import { PgOrdersRepository } from './store/pg-orders-repository.js';
import { checkHealth, checkSchemaVersion, createPool } from './store/pool.js';

/** Composition root. Never runs migrations (S4); use the `migrate` command. */
async function main(): Promise<void> {
  const config = loadConfig(); // fails fast on invalid config
  const pool = createPool(config.databaseUrl);
  const app = buildServer({
    service: createOrdersService(new PgOrdersRepository(pool)),
    health: { ping: () => checkHealth(pool), schemaCurrent: () => checkSchemaVersion(pool) },
    corsAllowedOrigins: config.corsAllowedOrigins,
    logger: { level: process.env.LOG_LEVEL ?? 'info' }, // pino JSON to stdout; T5 adds trace correlation
  });

  const shutdown = createShutdown({
    closeServer: () => app.close(),
    closePool: () => pool.end(),
    log: (msg, extra) => app.log.info(extra ?? {}, msg),
  });
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => void shutdown(signal).then((code) => process.exit(code)));
  }

  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((err: unknown) => {
  console.error(JSON.stringify({ level: 'fatal', msg: 'startup failed', err: String(err) }));
  process.exit(1);
});
