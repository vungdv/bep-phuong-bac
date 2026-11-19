import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { Order } from '../domain/order';
import type { OrdersApi } from '../api/orders-api';
import { OrdersApiProvider, useOrdersApi } from './api-context';
import { useOrders, usePendingDeliveryIds, useSetDelivered } from './orders';

const DAY = '2026-11-20';
const order = (id: string, no: number, delivered = false): Order => ({
  id, no, name: `N${no}`, qty: 1, message: '', createdAt: '2026-11-20T08:00:00+07:00', serviceDate: DAY, delivered,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(initial: Order[]) {
  let server = initial;
  const pending: ReturnType<typeof deferred<Order>>[] = [];
  const api: OrdersApi = {
    listOrders: vi.fn(async () => structuredClone(server)),
    setDelivered: vi.fn(() => {
      const d = deferred<Order>();
      pending.push(d);
      return d.promise;
    }),
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <OrdersApiProvider api={api}>{children}</OrdersApiProvider>
    </QueryClientProvider>
  );
  const hooks = () =>
    renderHook(
      () => ({ orders: useOrders(DAY), set: useSetDelivered(), pendingIds: usePendingDeliveryIds() }),
      { wrapper },
    );
  return { api, client, pending, hooks, setServer: (o: Order[]) => { server = o; } };
}

describe('api-context', () => {
  it('throws a clear error without a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => renderHook(() => useOrdersApi())).toThrow(/OrdersApiProvider/);
    spy.mockRestore();
  });
});

describe('useOrders', () => {
  it('loads the day under key [orders, date]', async () => {
    const t = setup([order('a', 1)]);
    const { result } = t.hooks();
    await waitFor(() => expect(result.current.orders.data).toEqual([order('a', 1)]));
    expect(t.api.listOrders).toHaveBeenCalledWith(DAY);
    expect(t.client.getQueryData(['orders', DAY])).toEqual([order('a', 1)]);
  });
});

describe('useSetDelivered', () => {
  const vars = (delivered: boolean) => ({ id: 'a', serviceDate: DAY, delivered });

  it('F27/F28 calls setDelivered with the new flag', async () => {
    const t = setup([order('a', 1)]);
    const { result } = t.hooks();
    await waitFor(() => expect(result.current.orders.data).toBeDefined());
    act(() => result.current.set.mutate(vars(true)));
    await waitFor(() => expect(t.api.setDelivered).toHaveBeenCalledWith('a', true));
    await act(async () => t.pending[0]!.resolve(order('a', 1, true)));
    act(() => result.current.set.mutate(vars(false)));
    await waitFor(() => expect(t.api.setDelivered).toHaveBeenLastCalledWith('a', false));
    await act(async () => t.pending[1]!.resolve(order('a', 1, false)));
  });

  it('F29 shows the optimistic state before the API resolves, F30 tracks pending ids', async () => {
    const t = setup([order('a', 1), order('b', 2)]);
    const { result } = t.hooks();
    await waitFor(() => expect(result.current.orders.data).toHaveLength(2));
    expect(result.current.pendingIds.size).toBe(0);
    act(() => result.current.set.mutate(vars(true)));
    await waitFor(() => expect(result.current.orders.data![0]!.delivered).toBe(true));
    expect(result.current.orders.data![1]!.delivered).toBe(false);
    expect(result.current.pendingIds.has('a')).toBe(true);
    expect(result.current.pendingIds.has('b')).toBe(false);
    t.setServer([order('a', 1, true), order('b', 2)]);
    await act(async () => t.pending[0]!.resolve(order('a', 1, true)));
    await waitFor(() => expect(result.current.pendingIds.size).toBe(0));
  });

  it('F31 restores the snapshot on failure and exposes the error', async () => {
    const t = setup([order('a', 1)]);
    const { result } = t.hooks();
    await waitFor(() => expect(result.current.orders.data).toBeDefined());
    act(() => result.current.set.mutate(vars(true)));
    await waitFor(() => expect(result.current.orders.data![0]!.delivered).toBe(true));
    // Hold the post-settle refetch so rollback is observable on its own.
    const refetch = deferred<Order[]>();
    vi.mocked(t.api.listOrders).mockImplementationOnce(() => refetch.promise);
    await act(async () => t.pending[0]!.reject(new Error('boom')));
    await waitFor(() => expect(t.api.listOrders).toHaveBeenCalledTimes(2));
    expect(t.client.isFetching({ queryKey: ['orders', DAY] })).toBe(1);
    expect(result.current.orders.data![0]!.delivered).toBe(false); // snapshot, refetch unresolved
    await act(async () => refetch.resolve([order('a', 1, false)]));
    await waitFor(() => expect(result.current.set.isError).toBe(true));
    expect(result.current.set.error?.message).toBe('boom');
    expect(result.current.pendingIds.size).toBe(0);
  });

  it('F32 shows server state after success via refetch of the day', async () => {
    const t = setup([order('a', 1)]);
    const { result } = t.hooks();
    await waitFor(() => expect(result.current.orders.data).toBeDefined());
    act(() => result.current.set.mutate(vars(true)));
    await waitFor(() => expect(result.current.orders.data![0]!.delivered).toBe(true));
    // Server disagrees with the optimistic value (e.g. changed elsewhere).
    t.setServer([order('a', 1, false)]);
    await act(async () => t.pending[0]!.resolve(order('a', 1, false)));
    await waitFor(() => expect(t.api.listOrders).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.orders.data![0]!.delivered).toBe(false));
  });

  it('cancels in-flight queries for the day on mutate', async () => {
    const t = setup([order('a', 1)]);
    const slow = deferred<Order[]>();
    const { result } = t.hooks();
    await waitFor(() => expect(result.current.orders.data).toBeDefined());
    vi.mocked(t.api.listOrders).mockImplementationOnce(() => slow.promise);
    act(() => { void t.client.invalidateQueries({ queryKey: ['orders', DAY] }); });
    await waitFor(() => expect(t.client.isFetching({ queryKey: ['orders', DAY] })).toBe(1));
    const cancel = vi.spyOn(t.client, 'cancelQueries');
    act(() => result.current.set.mutate(vars(true)));
    await waitFor(() => expect(cancel).toHaveBeenCalledWith({ queryKey: ['orders', DAY] }));
    slow.resolve([order('a', 1, false)]); // stale response must not clobber the optimistic write
    await act(async () => {});
    expect(result.current.orders.data![0]!.delivered).toBe(true);
    await act(async () => t.pending[0]!.resolve(order('a', 1, true)));
  });
});
