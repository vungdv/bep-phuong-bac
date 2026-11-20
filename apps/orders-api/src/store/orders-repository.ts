import type { Order } from '../domain/order.js';

export interface OrdersRepository {
  /** Orders whose service day equals `serviceDate` (YYYY-MM-DD), ascending by `no`. */
  listByServiceDate(serviceDate: string): Promise<Order[]>;
  /** Sets (never toggles) the delivered flag. Returns the updated order, or null if absent. */
  setDelivered(id: string, delivered: boolean): Promise<Order | null>;
}
