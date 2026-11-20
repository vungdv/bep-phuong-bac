import type { FastifyInstance } from 'fastify';

export const CORS_ALLOW_METHODS = 'GET, HEAD, PATCH, OPTIONS';
export const CORS_ALLOW_HEADERS = 'Content-Type, traceparent';
const PREFLIGHT_MAX_AGE = '600';

/**
 * B14/B15: CORS from an explicit allow-list. Allowed origin -> echoed back with Vary: Origin;
 * disallowed or absent origin -> no CORS headers at all. No wildcard unless configured.
 */
export function registerCors(app: FastifyInstance, allowedOrigins: readonly string[]): void {
  const allowed = new Set(allowedOrigins);
  app.addHook('onRequest', async (request, reply) => {
    const origin = request.headers.origin;
    const isAllowed = typeof origin === 'string' && allowed.has(origin);
    if (isAllowed) {
      reply.header('Access-Control-Allow-Origin', origin).header('Vary', 'Origin');
    }
    const isPreflight =
      request.method === 'OPTIONS' && typeof origin === 'string' && !!request.headers['access-control-request-method'];
    if (isPreflight) {
      if (isAllowed) {
        reply
          .header('Access-Control-Allow-Methods', CORS_ALLOW_METHODS)
          .header('Access-Control-Allow-Headers', CORS_ALLOW_HEADERS)
          .header('Access-Control-Max-Age', PREFLIGHT_MAX_AGE);
      }
      return reply.status(204).send();
    }
  });
}
