import type { Order } from '../domain/order';

export class NotFoundError extends Error {
  constructor(id: string) {
    super(`Order not found: ${id}`);
    this.name = 'NotFoundError';
  }
}

export interface OrdersApi {
  /** Orders of the local service day (YYYY-MM-DD), sorted by `no`; [] when none. */
  listOrders(serviceDate: string): Promise<Order[]>;
  /** Returns the updated order; rejects with NotFoundError for an unknown id. */
  setDelivered(id: string, delivered: boolean): Promise<Order>;
}
