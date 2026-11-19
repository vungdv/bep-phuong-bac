import { act } from 'react';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { Order } from './domain/order';
import { todayKey } from './domain/order';
import type { OrdersApi } from './api/orders-api';
import { App } from './app';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function order(id: string, serviceDate: string, name: string): Order {
  return {
    id,
    no: 1,
    name,
    qty: 1,
    message: '',
    createdAt: '2026-11-20T08:00:00+07:00',
    serviceDate,
    delivered: false,
  };
}

function fakeApi(byDay: Record<string, Order[]>): OrdersApi & { listOrders: ReturnType<typeof vi.fn> } {
  return {
    listOrders: vi.fn(async (d: string) => byDay[d] ?? []),
    setDelivered: vi.fn(),
  } as never;
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 20)); });

beforeAll(async () => {
  await import('./orders-app');
});

afterEach(() => {
  document.body.innerHTML = '';
  document.getElementById('bpb-orders-properties')?.remove();
});

async function mountElement(api: OrdersApi, attrs: Record<string, string> = {}) {
  const el = document.createElement('orders-app') as HTMLElement & { api?: OrdersApi };
  el.api = api;
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  await act(async () => { document.body.appendChild(el); });
  await flush();
  return el;
}

describe('orders-app element', () => {
  it('defines the tag once; importing twice does not throw', async () => {
    vi.resetModules();
    await expect(import('./orders-app')).resolves.toBeDefined();
    expect(customElements.get('orders-app')).toBeDefined();
  });

  it('renders in the shadow root with a style, light DOM stays empty', async () => {
    const el = await mountElement(fakeApi({}));
    expect(el.shadowRoot).not.toBeNull();
    expect(el.shadowRoot!.querySelector('style')).not.toBeNull();
    expect(el.shadowRoot!.querySelector('h1')).not.toBeNull();
    expect(el.children).toHaveLength(0);
  });

  it('unmounts on removal', async () => {
    const el = await mountElement(fakeApi({}));
    await act(async () => { el.remove(); });
    expect(el.shadowRoot!.querySelector('h1')).toBeNull();
    // reconnect mounts again
    await act(async () => { document.body.appendChild(el); });
    expect(el.shadowRoot!.querySelectorAll('h1')).toHaveLength(1);
    expect(el.shadowRoot!.querySelectorAll('style')).toHaveLength(1);
  });

  it('re-renders on lang change without refetching', async () => {
    const api = fakeApi({});
    const el = await mountElement(api, { lang: 'en' });
    const h1 = () => el.shadowRoot!.querySelector('h1')!.textContent;
    const en = h1();
    const calls = api.listOrders.mock.calls.length;
    await act(async () => { el.setAttribute('lang', 'vi'); });
    await flush();
    expect(h1()).not.toBe(en);
    expect(api.listOrders.mock.calls.length).toBe(calls);
  });

  it('missing or unsupported lang falls back to vi', async () => {
    const a = await mountElement(fakeApi({}));
    const vi1 = a.shadowRoot!.querySelector('h1')!.textContent;
    const b = await mountElement(fakeApi({}), { lang: 'fr' });
    expect(b.shadowRoot!.querySelector('h1')!.textContent).toBe(vi1);
    const c = await mountElement(fakeApi({}), { lang: 'en' });
    expect(c.shadowRoot!.querySelector('h1')!.textContent).not.toBe(vi1);
  });

  it('ignores the route attribute', async () => {
    const api = fakeApi({});
    const el = await mountElement(api);
    const calls = api.listOrders.mock.calls.length;
    await act(async () => { el.setAttribute('route', '/orders/x'); });
    expect(api.listOrders.mock.calls.length).toBe(calls);
    expect(el.shadowRoot!.querySelector('h1')).not.toBeNull();
  });
});

describe('App', () => {
  it('selects today by default and loads that day', async () => {
    const clock = { now: () => new Date(2026, 10, 20, 9).getTime() };
    const api = fakeApi({ '2026-11-20': [order('a', '2026-11-20', 'Khach A')] });
    render(<App lang="en" api={api} queryClient={new QueryClient()} clock={clock} />);
    expect(await screen.findByText('Khach A')).toBeInTheDocument();
    expect(api.listOrders).toHaveBeenCalledWith('2026-11-20');
    expect(todayKey(clock)).toBe('2026-11-20');
  });

  it('picking another day loads its orders', async () => {
    const clock = { now: () => new Date(2026, 10, 20, 9).getTime() };
    const api = fakeApi({
      '2026-11-20': [order('a', '2026-11-20', 'Khach A')],
      '2026-11-21': [order('b', '2026-11-21', 'Khach B')],
    });
    render(<App lang="en" api={api} queryClient={new QueryClient()} clock={clock} />);
    await screen.findByText('Khach A');
    fireEvent.click(screen.getByRole('button', { name: /date/i }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /21/ }));
    await waitFor(() => expect(api.listOrders).toHaveBeenCalledWith('2026-11-21'));
    expect(await screen.findByText('Khach B')).toBeInTheDocument();
  });
});
