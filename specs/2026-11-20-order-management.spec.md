# Order Management (prototype front-end)

Status: **Draft, ready for planning** · Owner: orders bounded context · Plan: [docs/plans/2026-11-20-order-management.plan.md](../docs/plans/2026-11-20-order-management.plan.md)

A prototype front-end that lets the kitchen see the meal pre-orders for one day and tick each one off as delivered. It opens on today's orders, and the user can pick another day from a calendar. The backend is mocked in `localStorage`. A real backend replaces it in a later spec without changing the UI.

## Context

The shell ([2026-11-19-micro-frontend-host.spec.md](2026-11-19-micro-frontend-host.spec.md)) mounts one remote, order management, as its `home` app. This spec defines that remote. The shell spec owns loading, routing and language resolution. This spec owns everything inside `<orders-app>`.

## Goals

1. Show the pre-orders for **today** by default, with the columns **No, Name, Qty., Message, CreateDate**.
2. Let the user switch to **another day** through a calendar that appears only after clicking a button.
3. Let the user **check and uncheck each order as delivered**, persisted by the backend.
4. Read and write data through a **backend seam** (TanStack Query over an `OrdersApi` interface), so that swapping the `localStorage` mock for a real REST backend touches only the API implementation.
5. Ship as a **shell remote**: one ES module that defines `<orders-app>`, which can also run standalone.

## Non-goals

- Creating, cancelling or deleting orders, and editing any field other than the delivered flag. Orders come from seeded mock data, and the only write is delivered / not delivered.
- Bulk actions (for example "mark all delivered"), delivery history and who delivered.
- A real backend, authentication or Zalo ingestion.
- Sub-routes, order detail views and `uses` children.
- A language switcher. Language comes from the shell's `lang` attribute.
- Search, filtering, sorting by other columns, paging and totals.
- Tracing or metrics inside the remote (the shell owns `traceparent` in v1).

## Users and stories

| ID | Story |
|---|---|
| US1 | As a chef, when I open the app I see today's pre-orders, so I know how many meals to cook. |
| US2 | As a chef, I can pick another day from a calendar, so I can check yesterday's or upcoming orders. |
| US3 | As a chef, I see the UI in my language (Vietnamese by default, English if my browser prefers it). |
| US4 | As a chef, I can check an order when it is delivered and uncheck it if I made a mistake, so I know which meals are still to go out. |

## Requirements (EARS)

Requirements follow the EARS syntax. Each one states a single behaviour that can be tested.

| Pattern | Template |
|---|---|
| Ubiquitous | The `<system>` shall `<response>`. |
| State-driven | While `<state>`, the `<system>` shall `<response>`. |
| Event-driven | When `<trigger>`, the `<system>` shall `<response>`. |
| Unwanted behaviour | If `<condition>`, then the `<system>` shall `<response>`. |
| Optional feature | Where `<feature is included>`, the `<system>` shall `<response>`. |

Systems: **orders app** (the `<orders-app>` element and its UI) and **mock backend** (`LocalStorageOrdersApi`).

### Default view (US1)

| ID | Pattern | Requirement |
|---|---|---|
| F1 | Event-driven | When the orders app is mounted, the orders app shall set the selected day to the current day in the browser's local time zone. |
| F2 | Ubiquitous | The orders app shall display the selected day's orders in a table with the columns **No**, **Name**, **Qty.**, **Message**, **CreateDate** and **Delivered**, in that order. |
| F3 | Ubiquitous | The orders app shall list the orders in ascending order of **No**. |
| F4 | Ubiquitous | The mock backend shall assign each order a **No** equal to its position (1, 2, 3, …) in creation order within its service day. |
| F5 | Ubiquitous | The orders app shall display **Name** as the person who pre-ordered and **Qty.** as the number of meals, a positive integer. |
| F6 | Ubiquitous | The orders app shall display **CreateDate** as the order's creation date and time, formatted with `Intl.DateTimeFormat` for the active language. |
| F7 | Unwanted behaviour | If an order's message is empty, then the orders app shall display an empty **Message** cell. |
| F8 | Ubiquitous | The orders app shall display the selected day in the page header, formatted for the active language. |

### Picking another day (US2)

| ID | Pattern | Requirement |
|---|---|---|
| F9 | Ubiquitous | The orders app shall provide a **"Pick date"** button that exposes `aria-expanded` (the calendar's open state) and `aria-controls` (the calendar's id). |
| F10 | State-driven | While the calendar is closed, the orders app shall not render the calendar in the DOM. |
| F11 | Event-driven | When the user clicks "Pick date" while the calendar is closed, the orders app shall open the calendar with the selected day highlighted. |
| F12 | Event-driven | When the user clicks "Pick date" while the calendar is open, the orders app shall close the calendar without changing the selected day. |
| F13 | Event-driven | When the user picks a day in the calendar, the orders app shall set that day as the selected day, close the calendar and load that day's orders. |
| F14 | Ubiquitous | The orders app shall allow any past or future day to be picked. |

### Loading, empty and error states (US1, US2)

| ID | Pattern | Requirement |
|---|---|---|
| F15 | State-driven | While the selected day's orders are loading, the orders app shall display a loading indicator with `role="status"`. |
| F16 | State-driven | While the loaded order list for the selected day is empty, the orders app shall display a "no orders for this day" message. |
| F17 | Unwanted behaviour | If loading the selected day's orders fails, then the orders app shall display an error message with `role="alert"` and a **Retry** button. |
| F18 | Event-driven | When the user clicks **Retry**, the orders app shall request the selected day's orders again. |

### Language (US3)

| ID | Pattern | Requirement |
|---|---|---|
| F19 | Ubiquitous | The orders app shall render its copy, dates and calendar locale in the language given by the `lang` attribute, supporting `vi` and `en`. |
| F20 | Unwanted behaviour | If the `lang` attribute is missing or is not `vi` or `en`, then the orders app shall use `vi`. |
| F21 | Event-driven | When the `lang` attribute changes on the mounted element, the orders app shall re-render in the new language without remounting or refetching. |

### Delivery status (US4)

| ID | Pattern | Requirement |
|---|---|---|
| F26 | Ubiquitous | The orders app shall display a **Delivered** checkbox for each order, checked when the order is delivered, with an accessible name that includes the order's **No** and **Name**. |
| F27 | Event-driven | When the user checks an order's Delivered checkbox, the orders app shall request the backend to mark that order as delivered. |
| F28 | Event-driven | When the user unchecks an order's Delivered checkbox, the orders app shall request the backend to mark that order as not delivered. |
| F29 | Event-driven | When the user toggles a Delivered checkbox, the orders app shall show the new state immediately, before the backend responds. |
| F30 | State-driven | While an order's delivery update is pending, the orders app shall disable that order's checkbox. |
| F31 | Unwanted behaviour | If a delivery update fails, then the orders app shall restore the checkbox to its previous state and display an error message with `role="alert"`. |
| F32 | Event-driven | When a delivery update succeeds, the orders app shall show the order's delivered state as returned by the backend. |

### Mock backend

| ID | Pattern | Requirement |
|---|---|---|
| F22 | Event-driven | When the mock backend starts and the storage key is absent, the mock backend shall seed several orders each for yesterday, today and tomorrow, and persist them. |
| F23 | Event-driven | When the mock backend starts and the storage key is present, the mock backend shall use the stored orders unchanged, even if the stored list is empty. |
| F24 | Unwanted behaviour | If the stored data cannot be parsed or the storage throws, then the mock backend shall serve an in-memory seed and log a structured warning, without failing the request. |
| F25 | Ubiquitous | The mock backend shall return the orders for the requested service day sorted by **No**, or an empty list for a day with no orders. |
| F33 | Event-driven | When the mock backend receives a delivery update for an existing order, the mock backend shall set that order's `delivered` flag, persist it to storage and return the updated order. |
| F34 | Unwanted behaviour | If a delivery update names an order id that does not exist, then the mock backend shall reject it with a not-found error. |
| F35 | Unwanted behaviour | If persisting a delivery update to storage fails, then the mock backend shall reject the update and leave the stored order unchanged. |
| F36 | Ubiquitous | The mock backend shall seed every order as not delivered, except some of yesterday's orders, which shall be seeded as delivered. |

## Architecture

### Stack
React 19, `@tanstack/react-query`, Tailwind CSS v4 (`@tailwindcss/vite`), `react-day-picker` v9 with `date-fns` locales, Vite, TypeScript strict. Tests: Vitest, happy-dom and `@testing-library/react`.

### Packaging (shell remote contract)
- Package `@bpb/orders` in `apps/orders/`. `vite build` (library mode) emits **one ES module**, `dist/orders-app.js`, with React and CSS bundled. Its only side effect is `customElements.define('orders-app', …)`, guarded with `customElements.get`.
- The element attaches an **open shadow root** and injects the compiled CSS (Tailwind and react-day-picker, imported with `?inline`) as a `<style>`, so no styles leak into the shell.
- Observed attributes: `lang` (F19–F21) and `route` (accepted and ignored in v1, since there are no sub-routes). The element mounts a React root on connect and unmounts it on disconnect.
- Standalone: `apps/orders/index.html` renders `<orders-app>` for local development.
- Shell wiring: `host.config.json` (dev) points `orders` at the orders dev server. `host.config.prod.json` keeps `./remotes/orders/orders-app.js`, and the deploy copies `dist/orders-app.js` there.

### Modules
```
apps/orders/src/
  orders-app.ts        # custom element: shadow root, CSS, React root, lang/route attributes
  app.tsx              # composition: QueryClient + OrdersApi providers, page layout
  domain/order.ts      # Order type, date-key helpers (pure)
  api/orders-api.ts    # OrdersApi interface (the backend seam)
  api/local-storage-orders-api.ts  # mock implementation + seed
  queries/orders.ts    # useOrders(serviceDate) query + useSetDelivered() mutation — TanStack Query
  ui/order-table.tsx   # table, Delivered checkboxes, loading/empty/error states
  ui/date-picker.tsx   # button + calendar toggle
  i18n/messages.ts     # vi/en string tables, fallback vi
```
Dependencies flow one way: `ui → queries → api (interface) ← api implementation`. The UI never touches `localStorage` directly.

### Data model
```ts
interface Order {
  id: string;          // stable unique id
  no: number;          // 1..n within serviceDate, creation order (F4)
  name: string;
  qty: number;         // positive integer
  message: string;     // may be ""
  createdAt: string;   // ISO 8601 with offset
  serviceDate: string; // YYYY-MM-DD, local day the meal is for
  delivered: boolean;  // F26–F36
}
```

### Backend seam
```ts
interface OrdersApi {
  listOrders(serviceDate: string): Promise<Order[]>; // sorted by no; [] when none
  setDelivered(id: string, delivered: boolean): Promise<Order>; // updated order; rejects with NotFoundError for an unknown id
}
```
- `useOrders(serviceDate)` uses `queryKey: ['orders', serviceDate]`. Each element instance creates one `QueryClient`.
- `useSetDelivered()` is a TanStack `useMutation` with an optimistic update. `onMutate` cancels in-flight queries for the order's day, snapshots the cache and writes the new flag (F29). `onError` restores the snapshot (F31). `onSettled` invalidates `['orders', serviceDate]` (F32).
- **Mock (v1):** `LocalStorageOrdersApi(storage, key, clock)`, implementing F22–F25 and F33–F36.
- **Target REST contract ([Deferred], real backend spec):** the mock mirrors these shapes so the swap is one class.
  - `GET /orders?serviceDate=YYYY-MM-DD` returns `200 application/json` with `Order[]`.
  - `PATCH /orders/{id}` with `Content-Type: application/merge-patch+json` (RFC 7396) and body `{ "delivered": true | false }` returns `200` with the updated `Order`, or `404` for an unknown id. The request is idempotent by nature, since it sets the flag rather than toggling it.
  - Errors use RFC 7807 Problem Details (`application/problem+json`).

## Testing

Every requirement is covered by at least one automated test.

| Area | Covers | Tests |
|---|---|---|
| `orders-app` | F19–F21 | Defines the tag once, renders inside the shadow root, injects styles, unmounts on removal, re-renders on `lang` change without refetching, missing or unsupported `lang` falls back to `vi`. |
| Domain | F1 | `toDateKey` uses the local day; `todayKey(clock)`. |
| Mock API | F4, F22–F25, F33–F36 | Filters by day, sorts by `no`, numbers 1..n per day, returns `[]` for an empty day, seeds once, never reseeds an empty store, survives corrupt JSON or throwing storage. `setDelivered` sets and clears the flag, persists across a new instance on the same storage, rejects an unknown id, and rejects without changing storage when the write throws. The seed's delivered flags are as specified. |
| Delivery toggle | F26–F32 | Checkbox state and accessible name, check and uncheck call `setDelivered` with `true` and `false`, the optimistic state shows before the API resolves, the checkbox is disabled while pending, it reverts and shows an alert on failure, and it shows the server state after success. Uses a fake `OrdersApi` with controllable promises. |
| Order table | F1–F3, F5–F8, F15–F18 | Today is the default, column order and labels in `vi` and `en`, CreateDate formatting, empty message cell, header date, and the loading, empty and error-with-Retry states. Uses a fake `OrdersApi`. |
| Date picker | F9–F14 | ARIA attributes, not in the DOM by default, opens on click with the selected day highlighted, a second click closes it without changing the day, picking a day calls `listOrders` with the new key and renders its rows, and past and future days can be picked. |

## Acceptance criteria

1. Opening the shell at `/#/` (or the standalone page) shows today's seeded orders, numbered 1..n, with all six columns.
2. With browser language `en-US` the labels are English. With `vi-VN`, `fr` or none they are Vietnamese.
3. No calendar is visible until "Pick date" is clicked. Picking yesterday shows yesterday's orders and updates the header date.
4. Reloading the page keeps the same data (it is persisted in `localStorage`, not reseeded).
5. Checking an order's Delivered box ticks it at once, and it stays checked after a reload. Unchecking it reverts that, and it stays unchecked after a reload.
6. Root `pnpm typecheck`, `pnpm test` and `pnpm build` pass, and `apps/orders/dist/orders-app.js` exists.

## Open questions

1. Should the service day follow the browser's time zone (the v1 default) or be fixed to `Asia/Ho_Chi_Minh`?
2. Does "CreateDate" need the time, or only the date? The v1 default shows both.
3. Should a delivered order record *when* it was delivered (`deliveredAt`), or be styled differently (for example muted or sorted last)? The v1 default is neither: it has only the boolean, and the row order stays by **No**.
4. When creating orders is in scope (from Zalo or a form), does `no` restart per day (assumed) or run globally?
