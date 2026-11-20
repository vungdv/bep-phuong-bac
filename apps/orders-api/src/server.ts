import Fastify, { type FastifyInstance } from 'fastify';
import { registerCors } from './http/cors.js';
import { registerHealthRoutes, type HealthChecks } from './http/health-route.js';
import { registerOrdersRoutes } from './http/orders-route.js';
import { registerOrderRoutes } from './http/order-route.js';
import { installProblemHandlers, type TraceIdProvider } from './http/problem.js';
import type { OrdersService } from './service/orders-service.js';

export interface ServerDeps {
  service: OrdersService;
  health: HealthChecks;
  /** Allowed CORS origins (B14/B15); empty means no CORS headers. */
  corsAllowedOrigins?: readonly string[];
  logger?: boolean | object;
  /** Active trace id source for Problem Details; telemetry plugs in here. */
  traceId?: TraceIdProvider;
}

/** Fastify app factory. Does not listen. */
export function buildServer({ service, health, corsAllowedOrigins = [], logger = false, traceId }: ServerDeps): FastifyInstance {
  const app = Fastify({ logger });
  registerCors(app, corsAllowedOrigins);
  installProblemHandlers(app, traceId);
  registerHealthRoutes(app, health, traceId);
  registerOrdersRoutes(app, service, traceId);
  registerOrderRoutes(app, service, traceId);
  return app;
}
