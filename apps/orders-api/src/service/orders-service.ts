import type { Order } from '../domain/order.js';
import type { OrdersRepository } from '../store/orders-repository.js';

/** No order has the requested id (B19). */
export class NotFoundError extends Error {
  constructor(readonly id: string) {
    super(`Order ${id} not found`);
    this.name = 'NotFoundError';
  }
}

export interface OrdersService {
  /** Orders for one service day (YYYY-MM-DD, already validated), in repository order (ascending `no`). */
  listOrders(serviceDate: string): Promise<Order[]>;
  /** Sets (never toggles) the delivered flag; returns the updated order. Throws NotFoundError if absent. */
  setDelivered(id: string, delivered: boolean): Promise<Order>;
}

export function createOrdersService(
  repo: Pick<OrdersRepository, 'listByServiceDate' | 'setDelivered'>,
): OrdersService {
  return {
    listOrders: (serviceDate) => repo.listByServiceDate(serviceDate),
    async setDelivered(id, delivered) {
      const order = await repo.setDelivered(id, delivered);
      if (order === null) throw new NotFoundError(id);
      return order;
    },
  };
}
