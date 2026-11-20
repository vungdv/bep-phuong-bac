import { describe, expect, it, vi } from 'vitest';
import type { Order } from '../domain/order.js';
import { NotFoundError, createOrdersService } from './orders-service.js';

const o = (no: number): Order => ({
  id: `00000000-0000-4000-8000-00000000000${no}`,
  no,
  name: `n${no}`,
  qty: 1,
  message: '',
  createdAt: '2026-11-19T01:30:00.000+00:00',
  serviceDate: '2026-11-20',
  delivered: false,
});

describe('OrdersService.listOrders', () => {
  it('passes the date through and preserves repository order', async () => {
    const rows = [o(3), o(1), o(2)];
    const listByServiceDate = vi.fn().mockResolvedValue(rows);
    const out = await createOrdersService({ listByServiceDate, setDelivered: vi.fn() }).listOrders('2026-11-20');
    expect(listByServiceDate).toHaveBeenCalledWith('2026-11-20');
    expect(out).toEqual(rows);
  });

  it('returns [] for an empty day', async () => {
    const svc = createOrdersService({ listByServiceDate: async () => [], setDelivered: async () => null });
    expect(await svc.listOrders('2026-11-22')).toEqual([]);
  });

  it('surfaces repository failures', async () => {
    const svc = createOrdersService({
      listByServiceDate: async () => {
        throw new Error('boom');
      },
      setDelivered: async () => null,
    });
    await expect(svc.listOrders('2026-11-20')).rejects.toThrow('boom');
  });
});

describe('OrdersService.setDelivered', () => {
  const none = async () => [];

  it('passes id and flag through and returns the updated order', async () => {
    const updated = { ...o(1), delivered: true };
    const setDelivered = vi.fn().mockResolvedValue(updated);
    const out = await createOrdersService({ listByServiceDate: none, setDelivered }).setDelivered(updated.id, true);
    expect(setDelivered).toHaveBeenCalledWith(updated.id, true);
    expect(out).toEqual(updated);
  });

  it('throws NotFoundError when the repository returns null', async () => {
    const svc = createOrdersService({ listByServiceDate: none, setDelivered: async () => null });
    const err = await svc.setDelivered('x', true).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(NotFoundError);
    expect((err as NotFoundError).id).toBe('x');
  });

  it('surfaces repository failures unchanged', async () => {
    const svc = createOrdersService({
      listByServiceDate: none,
      setDelivered: async () => {
        throw new Error('boom');
      },
    });
    await expect(svc.setDelivered('x', false)).rejects.toThrow('boom');
  });
});
