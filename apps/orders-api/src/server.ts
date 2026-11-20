import Fastify, { type FastifyInstance } from 'fastify';
import { registerOrdersRoutes } from './http/orders-route.js';
import { installProblemHandlers, type TraceIdProvider } from './http/problem.js';
import type { OrdersService } from './service/orders-service.js';

export interface ServerDeps {
  service: OrdersService;
  logger?: boolean | object;
  /** Active trace id source for Problem Details; telemetry plugs in here. */
  traceId?: TraceIdProvider;
}

/** Fastify app factory. Does not listen. */
export function buildServer({ service, logger = false, traceId }: ServerDeps): FastifyInstance {
  const app = Fastify({ logger });
  installProblemHandlers(app, traceId);
  registerOrdersRoutes(app, service, traceId);
  return app;
}
