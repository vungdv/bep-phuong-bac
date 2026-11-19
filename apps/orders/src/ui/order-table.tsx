import type { Lang } from '../i18n/messages';
import { formatCreatedAt, formatHeaderDate, getMessages } from '../i18n/messages';
import { useOrders, usePendingDeliveryIds, useSetDelivered } from '../queries/orders';

interface Props {
  serviceDate: string;
  lang: Lang;
}

/** F8: selected day, formatted for the active language. Placed in the page header by the app. */
export function HeaderDate({ serviceDate, lang }: Props) {
  return (
    <h2 className="text-xl font-semibold text-stone-800">{formatHeaderDate(serviceDate, lang)}</h2>
  );
}

const th = 'px-4 py-3 text-left text-sm font-semibold uppercase tracking-wide text-stone-600';
const td = 'px-4 py-3 align-middle text-base text-stone-900';

/** F2-F3, F5-F7, F15-F18, F26-F32. */
export function OrderTable({ serviceDate, lang }: Props) {
  const m = getMessages(lang);
  const orders = useOrders(serviceDate);
  const setDelivered = useSetDelivered();
  const pendingIds = usePendingDeliveryIds();

  if (orders.isPending) {
    return (
      <p role="status" className="py-8 text-center text-stone-600">
        {m.loading}
      </p>
    );
  }

  if (orders.isError) {
    return (
      <div role="alert" className="flex flex-col items-center gap-3 py-8 text-red-700">
        <p>{m.loadError}</p>
        <button
          type="button"
          onClick={() => void orders.refetch()}
          className="rounded-md bg-stone-800 px-4 py-2 text-white hover:bg-stone-700"
        >
          {m.retry}
        </button>
      </div>
    );
  }

  if (orders.data.length === 0) {
    return <p className="py-8 text-center text-stone-600">{m.noOrders}</p>;
  }

  const rows = [...orders.data].sort((a, b) => a.no - b.no);

  return (
    <div>
      {setDelivered.isError && (
        <p role="alert" className="mb-3 rounded-md bg-red-50 px-4 py-2 text-red-700">
          {m.updateFailed}
        </p>
      )}
      <table className="w-full border-collapse overflow-hidden rounded-lg bg-white shadow-sm">
        <thead className="bg-stone-100">
          <tr>
            <th scope="col" className={th}>{m.colNo}</th>
            <th scope="col" className={th}>{m.colName}</th>
            <th scope="col" className={th}>{m.colQty}</th>
            <th scope="col" className={th}>{m.colMessage}</th>
            <th scope="col" className={th}>{m.colCreateDate}</th>
            <th scope="col" className={th}>{m.colDelivered}</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-200">
          {rows.map((o) => (
            <tr key={o.id}>
              <td className={td}>{o.no}</td>
              <td className={td}>{o.name}</td>
              <td className={td}>{o.qty}</td>
              <td className={td}>{o.message}</td>
              <td className={td}>{formatCreatedAt(o.createdAt, lang)}</td>
              <td className={td}>
                <input
                  type="checkbox"
                  className="size-6 accent-emerald-600"
                  aria-label={m.deliveredLabel(o.no, o.name)}
                  checked={o.delivered}
                  disabled={pendingIds.has(o.id)}
                  onChange={(e) =>
                    setDelivered.mutate({ id: o.id, serviceDate, delivered: e.target.checked })
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
