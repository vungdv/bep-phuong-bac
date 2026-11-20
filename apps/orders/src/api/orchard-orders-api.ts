import type { Order } from '../domain/order';
import { HttpClient, HttpError, type HttpClientOptions } from './http';
import { NotFoundError, type OrdersApi } from './orders-api';

export interface OrchardOrdersApiOptions extends Omit<HttpClientOptions, 'getToken'> {
  baseUrl: string;
  getToken: () => Promise<string | undefined>;
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

const LIST_QUERY = `query ($day: String) {
  order(where: { serviceDate: $day }, orderBy: { createdUtc: ASC }) {
    contentItemId no customerName qty message serviceDate delivered createdUtc
  }
}`;

interface GraphQlOrder {
  contentItemId: string;
  no: number;
  customerName: string;
  qty: number;
  message: string | null;
  serviceDate: string;
  delivered: boolean;
  createdUtc: string;
}

interface GraphQlResponse {
  data?: { order?: GraphQlOrder[] };
  errors?: { message?: string }[];
}

/** Order content item as served by GET/POST /api/content (only the parts we read). */
interface OrderContentItem {
  ContentItemId: string;
  CreatedUtc: string;
  Order: {
    No: { Value: number };
    CustomerName: { Text: string };
    Qty: { Value: number };
    Message: { Text: string | null };
    ServiceDate: { Text: string };
    Delivered: { Value: boolean };
  };
  [key: string]: unknown;
}

/**
 * OrdersApi over Orchard Core: GraphQL for reads, read-modify-write on /api/content for updates (B8-B10).
 * `createdAt` is Orchard's UTC `createdUtc` ISO string (suffix `Z`), a valid ISO 8601 instant with offset.
 */
export class OrchardOrdersApi implements OrdersApi {
  private readonly base: string;
  private readonly http: HttpClient;

  constructor({ baseUrl, ...http }: OrchardOrdersApiOptions) {
    this.base = baseUrl.replace(/\/+$/, '');
    this.http = new HttpClient(http);
  }

  async listOrders(serviceDate: string): Promise<Order[]> {
    if (!DATE_KEY.test(serviceDate)) throw new RangeError(`Invalid service date: ${serviceDate}`);
    // The GraphQL read is a POST but idempotent, so it may be retried.
    const res = await this.http.request<GraphQlResponse>('POST', `${this.base}/api/graphql`, {
      body: { query: LIST_QUERY, variables: { day: serviceDate } },
      idempotent: true,
    });
    if (res.errors?.length) {
      throw new HttpError(200, `GraphQL error: ${res.errors.map((e) => e.message).join('; ')}`);
    }
    return (res.data?.order ?? []).map(fromGraphQl).sort((a, b) => a.no - b.no);
  }

  async setDelivered(id: string, delivered: boolean): Promise<Order> {
    const url = `${this.base}/api/content/${encodeURIComponent(id)}`;
    try {
      const item = await this.http.request<OrderContentItem>('GET', url, { idempotent: true });
      item.Order.Delivered.Value = delivered;
      // The update is never retried (B14).
      const updated = await this.http.request<OrderContentItem>('POST', `${this.base}/api/content`, { body: item });
      return fromContentItem(updated);
    } catch (err) {
      if (err instanceof HttpError && err.status === 404) throw new NotFoundError(id);
      throw err;
    }
  }
}

function fromGraphQl(o: GraphQlOrder): Order {
  return {
    id: o.contentItemId,
    no: o.no,
    name: o.customerName,
    qty: o.qty,
    message: o.message ?? '',
    createdAt: o.createdUtc,
    serviceDate: o.serviceDate,
    delivered: o.delivered,
  };
}

function fromContentItem(item: OrderContentItem): Order {
  const o = item.Order;
  return {
    id: item.ContentItemId,
    no: o.No.Value,
    name: o.CustomerName.Text,
    qty: o.Qty.Value,
    message: o.Message.Text ?? '',
    createdAt: item.CreatedUtc,
    serviceDate: o.ServiceDate.Text,
    delivered: o.Delivered.Value,
  };
}
