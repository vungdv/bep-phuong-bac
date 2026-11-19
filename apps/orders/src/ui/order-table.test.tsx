import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Order } from '../domain/order';
import type { OrdersApi } from '../api/orders-api';
import { OrdersApiProvider } from '../queries/api-context';
import { formatCreatedAt, formatHeaderDate, getMessages, type Lang } from '../i18n/messages';
import { HeaderDate, OrderTable } from './order-table';

const DAY = '2026-11-20';
const order = (no: number, over: Partial<Order> = {}): Order => ({
  id: `id${no}`, no, name: `Name${no}`, qty: no + 1, message: `msg${no}`,
  createdAt: '2026-11-20T08:30:00+07:00', serviceDate: DAY, delivered: false, ...over,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setup(initial: Order[], lang: Lang = 'en') {
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
  const ui = (l: Lang) => (
    <QueryClientProvider client={client}>
      <OrdersApiProvider api={api}>
        <OrderTable serviceDate={DAY} lang={l} />
      </OrdersApiProvider>
    </QueryClientProvider>
  );
  const view = render(ui(lang));
  return { api, pending, view, setServer: (o: Order[]) => { server = o; } };
}

describe.each(['vi', 'en'] as const)('OrderTable columns (%s)', (lang) => {
  it('shows the six columns in order with i18n labels', async () => {
    const m = getMessages(lang);
    setup([order(1)], lang);
    await screen.findByText('Name1');
    const heads = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(heads).toEqual([m.colNo, m.colName, m.colQty, m.colMessage, m.colCreateDate, m.colDelivered]);
    expect(screen.getAllByRole('columnheader')[0]).toHaveAttribute('scope', 'col');
  });

  it('renders row values and formatted CreateDate', async () => {
    setup([order(1)], lang);
    await screen.findByText('Name1');
    const cells = within(screen.getAllByRole('row')[1]!).getAllByRole('cell');
    expect(cells[0]).toHaveTextContent('1');
    expect(cells[1]).toHaveTextContent('Name1');
    expect(cells[2]).toHaveTextContent('2');
    expect(cells[3]).toHaveTextContent('msg1');
    expect(cells[4]).toHaveTextContent(formatCreatedAt('2026-11-20T08:30:00+07:00', lang));
  });

  it('header date follows the language', () => {
    render(<HeaderDate serviceDate={DAY} lang={lang} />);
    expect(screen.getByRole('heading')).toHaveTextContent(formatHeaderDate(DAY, lang));
  });
});

describe('OrderTable', () => {
  it('sorts rows by No ascending', async () => {
    setup([order(3), order(1), order(2)]);
    await screen.findByText('Name1');
    const names = screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[1]!.textContent);
    expect(names).toEqual(['Name1', 'Name2', 'Name3']);
  });

  it('renders an empty Message cell', async () => {
    setup([order(1, { message: '' })]);
    await screen.findByText('Name1');
    expect(within(screen.getAllByRole('row')[1]!).getAllByRole('cell')[3]).toBeEmptyDOMElement();
  });

  it('shows a loading status, then the rows', async () => {
    const t = setup([order(1)]);
    expect(screen.getByRole('status')).toHaveTextContent(getMessages('en').loading);
    await screen.findByText('Name1');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(t.api.listOrders).toHaveBeenCalledWith(DAY);
  });

  it('shows the empty state', async () => {
    setup([]);
    expect(await screen.findByText(getMessages('en').noOrders)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows an error with Retry that refetches and recovers', async () => {
    const user = userEvent.setup();
    const t = setup([order(1)]);
    await screen.findByText('Name1');
    t.view.unmount();
    // fresh render with a failing first load
    const api: OrdersApi = {
      listOrders: vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue([order(1)]),
      setDelivered: vi.fn(),
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <OrdersApiProvider api={api}>
          <OrderTable serviceDate={DAY} lang="en" />
        </OrdersApiProvider>
      </QueryClientProvider>,
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(getMessages('en').loadError);
    await user.click(screen.getByRole('button', { name: getMessages('en').retry }));
    expect(await screen.findByText('Name1')).toBeInTheDocument();
    expect(api.listOrders).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe.each(['vi', 'en'] as const)('Delivery toggle (%s)', (lang) => {
  const box = () => screen.getByRole('checkbox', { name: getMessages(lang).deliveredLabel(1, 'Name1') });

  it('has an accessible name with No and Name and reflects state', async () => {
    setup([order(1), order(2, { delivered: true })], lang);
    await screen.findByText('Name1');
    expect(box()).not.toBeChecked();
    expect(screen.getByRole('checkbox', { name: getMessages(lang).deliveredLabel(2, 'Name2') })).toBeChecked();
  });

  it('check/uncheck call setDelivered true/false, optimistic and disabled while pending', async () => {
    const user = userEvent.setup();
    const t = setup([order(1)], lang);
    await screen.findByText('Name1');
    await user.click(box());
    expect(t.api.setDelivered).toHaveBeenCalledWith('id1', true);
    await waitFor(() => expect(box()).toBeChecked());
    expect(box()).toBeDisabled();
    t.setServer([order(1, { delivered: true })]);
    t.pending[0]!.resolve(order(1, { delivered: true }));
    await waitFor(() => expect(box()).toBeEnabled());
    expect(box()).toBeChecked();

    await user.click(box());
    expect(t.api.setDelivered).toHaveBeenLastCalledWith('id1', false);
    await waitFor(() => expect(box()).not.toBeChecked());
    t.setServer([order(1)]);
    t.pending[1]!.resolve(order(1));
    await waitFor(() => expect(box()).toBeEnabled());
    expect(box()).not.toBeChecked();
  });

  it('only disables the pending order', async () => {
    const user = userEvent.setup();
    const t = setup([order(1), order(2)], lang);
    await screen.findByText('Name1');
    await user.click(box());
    await waitFor(() => expect(box()).toBeDisabled());
    expect(screen.getByRole('checkbox', { name: getMessages(lang).deliveredLabel(2, 'Name2') })).toBeEnabled();
    t.pending[0]!.resolve(order(1, { delivered: true }));
  });

  it('reverts and shows an alert on failure', async () => {
    const user = userEvent.setup();
    const t = setup([order(1)], lang);
    await screen.findByText('Name1');
    await user.click(box());
    await waitFor(() => expect(box()).toBeChecked());
    t.pending[0]!.reject(new Error('fail'));
    expect(await screen.findByRole('alert')).toHaveTextContent(getMessages(lang).updateFailed);
    expect(box()).not.toBeChecked();
    expect(box()).toBeEnabled();
  });

  it('shows the backend state after success', async () => {
    const user = userEvent.setup();
    const t = setup([order(1)], lang);
    await screen.findByText('Name1');
    await user.click(box());
    // backend ends up different from the optimistic guess
    t.pending[0]!.resolve(order(1, { delivered: false }));
    await waitFor(() => expect(box()).toBeEnabled());
    expect(box()).not.toBeChecked();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
