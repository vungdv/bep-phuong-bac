import type { Order } from '../domain/order.js';
import type { OrdersRepository } from '../store/orders-repository.js';

export interface OrdersService {
  /** Orders for one service day (YYYY-MM-DD, already validated), in repository order (ascending `no`). */
  listOrders(serviceDate: string): Promise<Order[]>;
}

export function createOrdersService(repo: Pick<OrdersRepository, 'listByServiceDate'>): OrdersService {
  return {
    listOrders: (serviceDate) => repo.listByServiceDate(serviceDate),
  };
}
