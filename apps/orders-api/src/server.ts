import Fastify, { LogController, type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import { registerCors } from './http/cors.js';
import { registerHealthRoutes, type HealthChecks } from './http/health-route.js';
import { registerOrdersRoutes } from './http/orders-route.js';
import { registerOrderRoutes } from './http/order-route.js';
import { installProblemHandlers, type TraceIdProvider } from './http/problem.js';
import type { Telemetry } from './telemetry.js';
import type { OrdersService } from './service/orders-service.js';

export interface ServerDeps {
  service: OrdersService;
  health: HealthChecks;
  /** Allowed CORS origins (B14/B15); empty means no CORS headers. */
  corsAllowedOrigins?: readonly string[];
  /** A pino logger (see logger.ts) or false. Fastify's default request logging is disabled; telemetry writes the access line. */
  logger?: FastifyBaseLogger | false;
  /** Request spans, `traceparent` echo, metrics and the access-log line (O1-O5). */
  telemetry?: Telemetry;
  /** Overrides the Problem Details trace id source; defaults to the telemetry's. */
  traceId?: TraceIdProvider;
}

/** Fastify app factory. Does not listen. */
export function buildServer({ service, health, corsAllowedOrigins = [], logger = false, telemetry, traceId: traceIdOverride }: ServerDeps): FastifyInstance {
  const app: FastifyInstance = Fastify(
    logger ? { loggerInstance: logger, logController: new LogController({ disableRequestLogging: true }) } : { logger: false },
  );
  const traceId = traceIdOverride ?? telemetry?.traceId;
  telemetry?.register(app); // first, so every response (CORS preflight, 404, errors) is traced
  registerCors(app, corsAllowedOrigins);
  installProblemHandlers(app, traceId);
  registerHealthRoutes(app, health, traceId);
  registerOrdersRoutes(app, service, traceId);
  registerOrderRoutes(app, service, traceId);
  return app;
}
