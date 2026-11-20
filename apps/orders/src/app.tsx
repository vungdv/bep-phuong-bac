import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { OrchardOrdersApi } from './api/orchard-orders-api';
import { authConfigFromEnv, getAuthClient, withReauth, type AuthEnv } from './auth/auth-client';
import type { OrdersApi } from './api/orders-api';
import { todayKey, type Clock } from './domain/order';
import { getMessages, type Lang } from './i18n/messages';
import { OrdersApiProvider } from './queries/api-context';
import { DatePicker } from './ui/date-picker';
import { HeaderDate, OrderTable } from './ui/order-table';

/**
 * Builds the OrdersApi once from Vite env (VITE_BACKEND_URL, see apps/orders/.env.development).
 * Signs in with Authorization Code + PKCE (B11).
 */
export function selectOrdersApi(env: AuthEnv = import.meta.env): OrdersApi {
  if (!env.VITE_BACKEND_URL) throw new Error('VITE_BACKEND_URL is required');
  const auth = getAuthClient(authConfigFromEnv(env));
  return new OrchardOrdersApi({
    baseUrl: env.VITE_BACKEND_URL,
    getToken: () => auth.getAccessToken(),
    fetch: withReauth(auth),
  });
}

export interface AppProps {
  lang: Lang;
  api: OrdersApi;
  /** One QueryClient per element instance, owned by the caller so lang changes keep the cache. */
  queryClient: QueryClient;
  clock?: Clock;
}

export function App({ lang, api, queryClient, clock = Date }: AppProps) {
  // F1: selected day starts as the browser-local current day.
  const [serviceDate, setServiceDate] = useState(() => todayKey(clock));
  const m = getMessages(lang);

  return (
    <QueryClientProvider client={queryClient}>
      <OrdersApiProvider api={api}>
        <main className="mx-auto max-w-4xl p-4 text-stone-900">
          <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-bold">{m.appTitle}</h1>
              <HeaderDate serviceDate={serviceDate} lang={lang} />
            </div>
            <DatePicker selectedDate={serviceDate} onSelect={setServiceDate} lang={lang} />
          </header>
          <OrderTable serviceDate={serviceDate} lang={lang} />
        </main>
      </OrdersApiProvider>
    </QueryClientProvider>
  );
}
