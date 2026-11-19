import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { OrdersApi } from './api/orders-api';
import { todayKey, type Clock } from './domain/order';
import { getMessages, type Lang } from './i18n/messages';
import { OrdersApiProvider } from './queries/api-context';
import { DatePicker } from './ui/date-picker';
import { HeaderDate, OrderTable } from './ui/order-table';

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
