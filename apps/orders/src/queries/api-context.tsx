import { createContext, useContext, type ReactNode } from 'react';
import type { OrdersApi } from '../api/orders-api';

const OrdersApiContext = createContext<OrdersApi | null>(null);

export function OrdersApiProvider({ api, children }: { api: OrdersApi; children: ReactNode }) {
  return <OrdersApiContext.Provider value={api}>{children}</OrdersApiContext.Provider>;
}

export function useOrdersApi(): OrdersApi {
  const api = useContext(OrdersApiContext);
  if (!api) {
    throw new Error('useOrdersApi must be used within an <OrdersApiProvider>');
  }
  return api;
}
