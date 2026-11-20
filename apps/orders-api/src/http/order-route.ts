import type { FastifyInstance } from 'fastify';
import { isUuid } from '../domain/order.js';
import { NotFoundError, type OrdersService } from '../service/orders-service.js';
import { orderSchema } from './order-schema.js';
import { NO_TRACE, problem, sendProblem, type TraceIdProvider } from './problem.js';

export const MERGE_PATCH = 'application/merge-patch+json';
export const ORDER_ALLOW = 'PATCH';

const patchSchema = { response: { 200: orderSchema } } as const;

/** Media type essence of a Content-Type header, lowercased, without parameters. */
function essence(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0]!.trim().toLowerCase();
}

/** Routes for one order: PATCH sets the delivered flag (B17-B24); other methods are 405 (B9). */
export function registerOrderRoutes(
  app: FastifyInstance,
  service: OrdersService,
  traceId: TraceIdProvider = NO_TRACE,
): void {
  // JSON Merge Patch bodies are plain JSON; a parse failure is a 400 Problem (B20).
  app.addContentTypeParser(MERGE_PATCH, { parseAs: 'string' }, (_request, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(Object.assign(new Error('Request body is not valid JSON.'), { statusCode: 400 }), undefined);
    }
  });

  app.route<{ Params: { id: string } }>({
    method: 'PATCH',
    url: '/orders/:id',
    schema: patchSchema,
    // B21: reject any other media type (including plain application/json) before the body is read.
    onRequest: async (request, reply) => {
      if (essence(request.headers['content-type']) !== MERGE_PATCH) {
        return sendProblem(
          reply,
          problem('unsupported-media-type', 'Unsupported media type', 415, `Use Content-Type: ${MERGE_PATCH}.`, traceId(request)),
          { 'Accept-Patch': MERGE_PATCH },
        );
      }
    },
    handler: async (request, reply) => {
      const { id } = request.params;
      const body = request.body;
      const valid =
        typeof body === 'object' &&
        body !== null &&
        !Array.isArray(body) &&
        Object.keys(body).length === 1 &&
        typeof (body as Record<string, unknown>).delivered === 'boolean';
      if (!valid) {
        return sendProblem(
          reply,
          problem(
            'invalid-patch',
            'Invalid patch',
            400,
            'Body must be a JSON object with exactly one member, "delivered", set to true or false.',
            traceId(request),
          ),
        );
      }
      const notFound = () =>
        sendProblem(reply, problem('not-found', 'Not found', 404, 'No order has the given id.', traceId(request)));
      if (!isUuid(id)) return notFound();
      try {
        const order = await service.setDelivered(id, (body as { delivered: boolean }).delivered);
        return reply.header('Cache-Control', 'no-store').send(order);
      } catch (err) {
        if (err instanceof NotFoundError) return notFound();
        throw err;
      }
    },
  });

  app.route({
    method: ['GET', 'PUT', 'DELETE', 'POST'],
    url: '/orders/:id',
    handler: async (request, reply) =>
      sendProblem(
        reply,
        problem('method-not-allowed', 'Method not allowed', 405, `Use ${ORDER_ALLOW} on /orders/{id}.`, traceId(request)),
        { Allow: ORDER_ALLOW },
      ),
  });
}
