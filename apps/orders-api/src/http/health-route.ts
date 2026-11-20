import type { FastifyInstance } from 'fastify';
import { NO_TRACE, problem, sendProblem, type TraceIdProvider } from './problem.js';

/** Readiness inputs, injected so route tests can fake them. */
export interface HealthChecks {
  ping(): Promise<boolean>;
  schemaCurrent(): Promise<boolean>;
}

export function registerHealthRoutes(
  app: FastifyInstance,
  health: HealthChecks,
  traceId: TraceIdProvider = NO_TRACE,
): void {
  // B16 liveness: no dependencies.
  app.get('/healthz', async (_req, reply) => reply.header('Cache-Control', 'no-store').send({ status: 'ok' }));

  // B16/S4 readiness: store reachable and schema not behind.
  app.get('/readyz', async (request, reply) => {
    const notReady = (detail: string) =>
      sendProblem(reply, problem('not-ready', 'Service not ready', 503, detail, traceId(request)), {
        'Cache-Control': 'no-store',
      });
    let pingOk = false;
    let schemaOk = false;
    try {
      pingOk = await health.ping();
      schemaOk = pingOk && (await health.schemaCurrent());
    } catch {
      /* treated as not ready */
    }
    if (!pingOk) return notReady('The order store is not reachable.');
    if (!schemaOk) return notReady('The database schema is behind; run the migrate command.');
    return reply.header('Cache-Control', 'no-store').send({ status: 'ready' });
  });
}
