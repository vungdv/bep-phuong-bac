import { SpanKind, SpanStatusCode, type Tracer } from '@opentelemetry/api';
import type { OrdersRepository } from './orders-repository.js';

/**
 * Decorator (O2): runs every repository call inside a child span of the active request span.
 * Records exceptions and sets ERROR status on failure. Never records arguments (ids, contents).
 */
export function withTracing(repo: OrdersRepository, tracer: Tracer): OrdersRepository {
  const run = <T>(operation: string, fn: () => Promise<T>): Promise<T> =>
    tracer.startActiveSpan(
      `orders.${operation}`,
      { kind: SpanKind.CLIENT, attributes: { 'db.system.name': 'postgresql', 'db.operation.name': operation } },
      async (span) => {
        try {
          const result = await fn();
          span.setStatus({ code: SpanStatusCode.OK });
          return result;
        } catch (err) {
          span.recordException(err as Error);
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw err;
        } finally {
          span.end();
        }
      },
    );
  return {
    listByServiceDate: (serviceDate) => run('listByServiceDate', () => repo.listByServiceDate(serviceDate)),
    setDelivered: (id, delivered) => run('setDelivered', () => repo.setDelivered(id, delivered)),
  };
}
