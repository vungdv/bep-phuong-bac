import type { Pool } from 'pg';
import type { Order } from '../domain/order.js';
import type { OrdersRepository } from './orders-repository.js';

interface OrderRow {
  id: string;
  no: number;
  name: string;
  qty: number;
  message: string;
  created_at: Date;
  service_date: string;
  delivered: boolean;
}

// service_date is formatted in SQL so pg's date parser (local-time Date) can never shift it.
const COLUMNS = `id, no, name, qty, message, created_at,
  to_char(service_date, 'YYYY-MM-DD') AS service_date, delivered`;

function toOrder(r: OrderRow): Order {
  return {
    id: r.id,
    no: r.no,
    name: r.name,
    qty: r.qty,
    message: r.message,
    createdAt: r.created_at.toISOString().replace(/Z$/, '+00:00'),
    serviceDate: r.service_date,
    delivered: r.delivered,
  };
}

export class PgOrdersRepository implements OrdersRepository {
  constructor(private readonly pool: Pick<Pool, 'query'>) {}

  async listByServiceDate(serviceDate: string): Promise<Order[]> {
    const res = await this.pool.query<OrderRow>(
      `SELECT ${COLUMNS} FROM orders WHERE service_date = $1::date ORDER BY no ASC`,
      [serviceDate],
    );
    return res.rows.map(toOrder);
  }

  async setDelivered(id: string, delivered: boolean): Promise<Order | null> {
    // A non-UUID id can never match; avoid a cast error from Postgres.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
    const res = await this.pool.query<OrderRow>(
      `UPDATE orders SET delivered = $2 WHERE id = $1::uuid RETURNING ${COLUMNS}`,
      [id, delivered],
    );
    const row = res.rows[0];
    return row ? toOrder(row) : null;
  }
}
