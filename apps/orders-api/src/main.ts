import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createTelemetry } from './telemetry.js';
import { createOrdersService } from './service/orders-service.js';
import { buildServer } from './server.js';
import { createShutdown } from './shutdown.js';
import { PgOrdersRepository } from './store/pg-orders-repository.js';
import { withTracing } from './store/traced-orders-repository.js';
import { checkHealth, checkSchemaVersion, createPool } from './store/pool.js';

/** Composition root. Never runs migrations (S4); use the `migrate` command. */
async function main(): Promise<void> {
  const config = loadConfig(); // fails fast on invalid config
  const pool = createPool(config.databaseUrl);
  const telemetry = createTelemetry({ serviceName: config.otelServiceName, otlpEndpoint: config.otelExporterOtlpEndpoint });
  const app = buildServer({
    service: createOrdersService(withTracing(new PgOrdersRepository(pool), telemetry.tracer)),
    health: { ping: () => checkHealth(pool), schemaCurrent: () => checkSchemaVersion(pool) },
    corsAllowedOrigins: config.corsAllowedOrigins,
    logger: createLogger({ level: process.env.LOG_LEVEL ?? 'info' }), // pino JSON to stdout, trace-correlated
    telemetry,
  });

  const shutdown = createShutdown({
    closeServer: () => app.close(),
    closePool: async () => {
      await pool.end();
      await telemetry.shutdown(); // flush spans and metrics last
    },
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
