import { useMemo } from 'react';
import { useMutation, useMutationState, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Order } from '../domain/order';
import { useOrdersApi } from './api-context';

export const ordersKey = (serviceDate: string) => ['orders', serviceDate] as const;
export const SET_DELIVERED_KEY = ['orders', 'setDelivered'] as const;

export interface SetDeliveredVariables {
  id: string;
  serviceDate: string;
  delivered: boolean;
}

export function useOrders(serviceDate: string) {
  const api = useOrdersApi();
  return useQuery({
    queryKey: ordersKey(serviceDate),
    queryFn: () => api.listOrders(serviceDate),
  });
}

/**
 * F27/F28 request, F29 optimistic write, F31 rollback, F32 refetch on settle.
 * The returned mutation exposes `isError`/`error` so the UI can show a failure (F31).
 */
export function useSetDelivered() {
  const api = useOrdersApi();
  const queryClient = useQueryClient();
  return useMutation<Order, Error, SetDeliveredVariables, { previous: Order[] | undefined }>({
    mutationKey: SET_DELIVERED_KEY,
    mutationFn: ({ id, delivered }) => api.setDelivered(id, delivered),
    onMutate: async ({ id, serviceDate, delivered }) => {
      const key = ordersKey(serviceDate);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<Order[]>(key);
      queryClient.setQueryData<Order[]>(key, (old) =>
        old?.map((o) => (o.id === id ? { ...o, delivered } : o)),
      );
      return { previous };
    },
    onError: (_err, { serviceDate }, context) => {
      queryClient.setQueryData(ordersKey(serviceDate), context?.previous);
    },
    onSettled: (_data, _err, { serviceDate }) =>
      queryClient.invalidateQueries({ queryKey: ordersKey(serviceDate) }),
  });
}

/** F30: ids of orders whose delivery update is in flight. */
export function usePendingDeliveryIds(): ReadonlySet<string> {
  const ids = useMutationState({
    filters: { mutationKey: SET_DELIVERED_KEY, status: 'pending' },
    select: (m) => (m.state.variables as SetDeliveredVariables).id,
  });
  return useMemo(() => new Set(ids), [ids.join('\u0000')]);
}
