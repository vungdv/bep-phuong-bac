import type { FastifyInstance } from 'fastify';
import { parseServiceDate } from '../domain/order.js';
import type { OrdersService } from '../service/orders-service.js';
import { orderSchema } from './order-schema.js';
import { NO_TRACE, problem, sendProblem, type TraceIdProvider } from './problem.js';

const listSchema = { response: { 200: { type: 'array', items: orderSchema } } } as const;

export const ORDERS_ALLOW = 'GET, HEAD';

export function registerOrdersRoutes(
  app: FastifyInstance,
  service: OrdersService,
  traceId: TraceIdProvider = NO_TRACE,
): void {
  app.get('/orders', { schema: listSchema }, async (request, reply) => {
    const serviceDate = parseServiceDate((request.query as Record<string, unknown>).serviceDate);
    if (serviceDate === null) {
      return sendProblem(
        reply,
        problem(
          'invalid-service-date',
          'Invalid service date',
          400,
          'serviceDate must be a real date in YYYY-MM-DD form.',
          traceId(request),
        ),
      );
    }
    const orders = await service.listOrders(serviceDate);
    return reply.header('Cache-Control', 'no-cache').send(orders);
  });

  // B9: any other method on /orders is 405 with the supported set.
  app.route({
    method: ['POST', 'PUT', 'PATCH', 'DELETE'],
    url: '/orders',
    handler: async (request, reply) =>
      sendProblem(
        reply,
        problem('method-not-allowed', 'Method not allowed', 405, `Use ${ORDERS_ALLOW} on /orders.`, traceId(request)),
        { Allow: ORDERS_ALLOW },
      ),
  });
}
