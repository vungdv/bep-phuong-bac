# Micro-Frontend Host (Shell)
A spec to build a host of a micro-frontend where each app is a web component. Each app will be defined in app manifest and load dynamically at runtime.

## v1 scope (decided)

v1 ships **a single app with no header**:
- **One app, no header.** The only remote is order management. The shell mounts it full-page. There is no navigation, no header region and no global widgets (notifications, messages).
- **Languages: `vi` and `en`.** The shell picks the browser language and defaults to `vi` (see [Language resolution](#language-resolution)). There is no language switcher in v1, because the switcher lived in the header.
- **Everything about the header is deferred, not deleted.** Sections and rows marked **[Deferred]** describe the post-v1 design and must not be built in v1. The contract (`nav`, `languages`, `mf:language-change`, `layout.header`) stays reserved so adding a header later needs no breaking change.

- **Hash routes come from a separate route-map config.** Opening `/#order` or `/#orderv2` loads the app mapped to that hash in `routes.config.json`, which is separate from `host.config.json` (see [Route map config](#route-map-config)). Still no header.

What v1 builds: manifest + validation, route map config, `LanguageResolver`, Router, Outlet, `ModuleLoader`, mediator, `uses` composition, `mf:navigate`. What v1 does not build: `HeaderRegion`, header fallback, the `nav` / `languages` attributes and `mf:language-change` handling.

## Goal

Ship an empty but production-shaped shell that:
1. Fetches a manifest that declares **apps**, **routes** and a default **home** app (and, **[Deferred]**, a `layout` with a header app).
2. Resolves one language (`vi` or `en`) from the browser and passes it to the mounted app as `lang`.
3. Loads the **home app** at `#/` and, on a route change, the route's **master app**, into the content area. A master may compose other apps inside itself. With one app, the home app is the whole product.
4. Contains any failure to the smallest region: one route or one child. **[Deferred]** The header joins this list once it exists.

The first remote is the order-management app (see [2026-11-20-order-management.spec.md](2026-11-20-order-management.spec.md)). It is **out of scope here**. The shell is verified with stub remotes (see [Testing](#testing)).

## Non-goals
- Any remote app's code or business logic (orders, Zalo ingestion), and the real header's visual design.
- Authentication, SSR, SEO.
- A header, navigation, global widgets and a language switcher in v1 (see [v1 scope](#v1-scope-decided)).
- Translating remote content. Each remote owns its own strings. The shell only tells remotes which language to use.
- Shared runtime dependencies or Module Federation. Each remote bundles its own framework, and there are no import maps in v1.
- Shell-owned business state. The shell never reads or writes order data.
- Relaying events between apps. Apps talk to each other through contract-defined `mf:` events on `window`, not through the shell.

## Concepts

| Concept | What it is | Who declares it |
|---|---|---|
| **App** | A loadable unit: `{ url, tag, attributes?, uses? }`. Loading it defines one custom element. It knows nothing about where it will be shown. | Manifest `apps` |
| **Route** | A hash path that maps to **one master app** shown in the content area (the Outlet). It can carry a `label`, which makes it appear in the header's navigation. | Manifest `routes` |
| **Home** | The app shown at `#/` (e.g. `orders`). It is a route master like any other. With a single app it makes the shell open straight into the product. | Manifest `home` |
| **Layout region** | **[Deferred]** A fixed shell region that mounts one app independent of the current route. The only planned region is `header`. Not built in v1. | Manifest `layout` |
| **Composition** | An app rendering other apps inside its own DOM. Declared by `uses`, performed by the parent app itself. Used by route masters (e.g. `orders` → `order-detail`) and by the header (e.g. `header` → `notifications`, `messages`). | Manifest `apps.<id>.uses` + the parent's code |

One app can appear in several places. For example `order-detail` can be a child of `orders`, and `notifications` can be a header child while also having its own route. The same tag is loaded once and instantiated as many times as needed. A route can override attributes (e.g. `variant: full`).

The shell itself renders only what no remote can: the **frame** (`#mf-outlet`; **[Deferred]** `#mf-header`), and the Outlet's loading, not-found and error views (and the route list when no `home` is set). Everything else is a remote.

## Architecture

Each remote is one ES module whose only side effect is `customElements.define(tag, …)`. The shell knows remotes only as manifest entries and never imports them at build time.

Browser support: evergreen browsers with ES modules, dynamic `import()` and Custom Elements v1. Autonomous custom elements only.

### Runtime flow
1. Shell fetches `host.config.json` and, in parallel, the route map from its `routesUrl` (both `cache: 'no-cache'`), then validates them together.
2. Shell resolves the language (see [Language resolution](#language-resolution)).
3. **In parallel and independent of each other** (v1 runs only the second item):
   - **[Deferred]** the shell loads the **header app** and its `uses`, and mounts it into `#mf-header`;
   - the Router matches `location.hash` against `routes` (longest segment-prefix wins; see [Routing](#routing)), treating `#/` as the `home` app, and loads the **master app** and its `uses`.
4. Per app: if `customElements.get(tag)` is already defined it skips the network. Otherwise it runs `import(url)` and awaits `customElements.whenDefined(tag)`, raced against a timeout (default 10 s).
5. When an app (header or master) is ready, its region creates the element, sets attributes **before** `append`, and mounts it. Navigating to a different master removes the old element. The **header is never unmounted** by navigation. Definitions stay registered, so revisits skip the import.
6. Failures, by scope:
   - **Global** (manifest fetch, parse or validation fails): error panel with Retry in the Outlet. Nothing else can render.
   - **[Deferred] Header** (header import rejects or times out): `#mf-header` shows a minimal shell-rendered fallback: a link home plus an error badge with Retry. Routes keep working, and the home view lists them.
   - **Route** (master import rejects, or `whenDefined` times out, e.g. the module defines a different tag): error panel in the Outlet with Retry for that route only. The header keeps working.
   - **Child** (a `uses` app of a master (or, **[Deferred]**, of the header) fails): non-fatal. The shell logs a warning and does not block the parent. The parent sees an undefined tag and renders its own fallback (see [Composition](#composition)).
   - Retry re-imports with `?retry=<n>` appended (keeping existing query and fragment) to defeat the browser's module-map cache.
7. Unknown hash: not-found view with a link home. Empty hash and `#` mean `#/`, which mounts the `home` app. With no `home`, `#/` shows the route list (or "No apps registered").

### Routing

- A route is `{ path, app, label?, attributes? }`, declared in the [route map config](#route-map-config). `path` matches `^#\/[a-z0-9][a-z0-9-]*$` (one segment). The browser hash is normalized first (`#order` → `#/order`), so `/#order`, `/#/order` and `/#orderv2` all resolve through the same map.
- **Prefix matching by segment.** Route `#/orders` matches `#/orders`, `#/orders/123` and `#/orders/123/items`, but not `#/orders-archive`. If several routes match, the longest wins. The master owns everything after its prefix (sub-routes, detail views, composing children).
- The shell gives the master the full current hash in the `route` attribute (set before `append`). When the hash changes but still resolves to the **same app**, the shell updates the `route` attribute on the mounted element. It does **not** remount. A different app unmounts the old one and mounts the new one.
- The header also receives `route` and is updated on **every** hash change, so it can highlight the active link.
- Header links are plain `<a href="#/orders">`, so navigation needs no event. Apps that navigate programmatically dispatch `mf:navigate` with a path. The shell sets the hash and the flow above applies.
- `mf:navigate` is accepted for `#/` or any path that matches a declared route. Other paths are ignored and logged.

### Header **[Deferred, not in v1]**

The header is an ordinary app, mounted into the `layout.header` region, with the contract below. Beyond that contract, the shell knows nothing about it.

- **Navigation.** The shell builds `nav` from the routes that have a `label`, in manifest order: `[{ "path": "#/orders", "label": { "vi": "Đơn hàng", "en": "Orders" } }]`. A `label` is a string or a map of language tag → string. Routes without a label (e.g. detail routes) stay out of navigation. The header chooses the label for its current `lang` and falls back to the first entry.
- **Active link.** The header compares `route` to each `nav` path by segment prefix, the same rule as the Router.
- **Language switcher.** The header receives `languages` (the supported tags) and `lang` (the active one). When the user picks a language it dispatches `mf:language-change { lang }`. The shell validates it, applies it (see [Language resolution](#language-resolution)) and updates the `lang` attribute on the header.
- **Global widgets.** The header composes notifications, messages and similar apps through `uses`. The header never unmounts, so these apps keep their live state (counters, sockets) across route changes. Clicking a notification dispatches `mf:navigate`.
- **Failure isolation.** The header failing never blocks routes, and a failing widget never breaks the header (child rule).

### Composition

A parent app (the header or a route master) composes children **inside its own shadow DOM**, using the child's tag directly (`<order-detail-app>`). The shell does not render children. It only guarantees they are loaded:

- `uses: ["order-detail", "customer-picker"]` on the parent's app entry makes the shell load those apps in parallel with the parent. This only means "their modules were requested". The parent still waits for them with `customElements.whenDefined(tag)`.
- A child failure never fails the parent's route or region (see Failures above). The parent decides what to show: `customElements.get(tag)` still undefined after a reasonable wait means render a fallback.
- `uses` is not transitive: the shell loads the `uses` of the header or master, **not** the `uses` of its children. If a child needs a grandchild, the parent lists both. This keeps the load graph visible in the manifest.
- Cycles (`A uses B`, `B uses A`) and `uses` of an unknown app fail validation.
- The parent sets attributes on children itself, including `lang` (forwarded from its own `lang`, because the shell cannot reach into a shadow root).
- Children use the same contract as everyone else: attributes down, `mf:` events up. Events must be `bubbles: true, composed: true` so they cross the parent's shadow boundary and reach `window`.

### Integration contract (the only coupling)

"Attributes down, events up."

| Channel | Direction | Contract |
|---|---|---|
| Element | shell → app | Tag name plus resolved attributes, set before `append`. Merge order, last wins: app `attributes`, then route `attributes`, then shell-owned attributes (below). The shell only creates, configures and removes elements. |
| `lang` | shell → header, master | Standard BCP 47 attribute, set before `append` and updated in place when the language changes. The shell also sets `document.documentElement.lang`. Parents forward it to children. |
| `route` | shell → header, master | Full current hash. Set before `append`, updated in place on every hash change that the receiver should see (always for the header, same-app navigation for a master). |
| `nav` | shell → header | JSON array of `{ path, label }`, built from labeled routes. Header only. |
| `languages` | shell → header | JSON array of supported language tags. Header only. |
| `mf:navigate` | app → shell | `CustomEvent<{ path: string }>`, `bubbles: true, composed: true`, caught by one `window` listener. |
| `mf:language-change` | header → shell | `CustomEvent<{ lang: string }>`, `bubbles: true, composed: true`. Ignored and logged unless `lang` is in `supported`. |
| Cross-app events | app → app | `mf:`-prefixed `CustomEvent` on `window`, with names and detail types declared in `packages/contracts`. The shell does not inspect or relay them. Example: `mf:order-updated`. |
| Styling | shell → app | CSS custom properties only (`--mf-color-primary`, `--mf-font-family`, …) declared on `:root`. |

`lang`, `route`, `nav` and `languages` are **shell-owned attribute names**, and the manifest may not set them. Event names, tag names and manifest types live in `packages/contracts`: types and constants only, never runtime behavior.

### Route map config

Route mapping lives in its own file, **`routes.config.json`**, not in `host.config.json`. `host.config.json` declares *what can be loaded* (apps, languages, home). The route map declares *which hash loads which app*. Changing a hash mapping (e.g. adding `#orderv2`) needs no edit to the app manifest.

```json
{
  "routes": [
    { "path": "#/order",   "app": "orders" },
    { "path": "#/orderv2", "app": "orders-v2", "attributes": { "variant": "v2" } }
  ]
}
```

- **Hash forms.** The browser URL may be `/#order`, `/#/order` or `/#orderv2`. The Router normalizes a hash by stripping `#` and any leading `/`, then compares it as `#/<name>`. So `#order` and `#/order` are the same route. Segment-prefix matching (see [Routing](#routing)) keeps `#order` and `#orderv2` apart: `#orderv2` does not match `#/order`.
- **Where it is declared.** `host.config.json` has `"routesUrl": "./routes.config.json"`, resolved against the manifest URL. The shell fetches both files in parallel (`cache: 'no-cache'`). Two files ship per environment: `routes.config.json` (dev) and `routes.config.prod.json`. The deploy copies the prod ones over the dev ones, as with the manifest.
- **Fallback.** If `routesUrl` is absent, the shell uses an empty route list (only `#/` and `home` work). If it is declared but fails to fetch or parse, that is a **global** failure (error panel with Retry in the Outlet).
- **Validation.** Route entries are validated after both files load, because `app` must name an id in `host.config.json` `apps`. Errors from both files are collected and reported together. Rules are under [Manifest](#manifest-hostconfigjson) validation.

### Manifest (`host.config.json`)

v1 manifest (single app, no header):

```json
{
  "languages": { "supported": ["vi", "en"], "fallback": "vi" },
  "home": "orders",
  "routesUrl": "./routes.config.json",
  "apps": {
    "orders":    { "url": "./remotes/orders/orders-app.js", "tag": "orders-app" },
    "orders-v2": { "url": "./remotes/orders-v2/orders-v2-app.js", "tag": "orders-v2-app" }
  }
}
```

`home` is the app mounted at `#/`. Routes are optional in v1 and live in the [route map config](#route-map-config). When the orders app grows sub-views it owns them under its own prefix, e.g. `{ "path": "#/order", "app": "orders" }` so `#/order/123` reaches it.

**[Deferred]** Post-v1 shape with a header, widgets and composition:

```json
{
  "languages": { "supported": ["vi", "en"], "fallback": "vi" },
  "layout": { "header": { "app": "header" } },
  "home": "orders",
  "apps": {
    "header":          { "url": "./remotes/header/header-app.js", "tag": "bpb-header",
                         "uses": ["notifications", "messages"] },
    "notifications":   { "url": "./remotes/notifications/notifications-app.js", "tag": "notifications-app" },
    "messages":        { "url": "./remotes/messages/messages-app.js", "tag": "messages-app" },
    "orders":          { "url": "./remotes/orders/orders-app.js", "tag": "orders-app",
                         "uses": ["order-detail", "customer-picker"] },
    "order-detail":    { "url": "./remotes/order-detail/order-detail-app.js", "tag": "order-detail-app" },
    "customer-picker": { "url": "./remotes/customer-picker/customer-picker.js", "tag": "customer-picker" }
  },
  "routes": [
    { "path": "#/orders", "app": "orders",   "label": { "vi": "Đơn hàng", "en": "Orders" } },
    { "path": "#/inbox",  "app": "messages", "label": "Inbox", "attributes": { "variant": "full" } }
  ]
}
```

Validation (all errors are collected and reported together; unknown fields are dropped):
- **`apps.<id>`:** `url` required, resolved against the **manifest URL** (not the shell bundle), relative in production and `http://localhost:<port>/…` in dev. `tag` required: a valid custom element name (lowercase ASCII, contains a hyphen, not HTML-reserved), **unique across apps**. `attributes` optional: flat map of name (`[a-z][a-z0-9-]*`) → string, and the shell-owned names are rejected. `uses` optional: array of existing app ids, no self-reference, no cycles.
- **`routesUrl`:** optional string, resolved against the manifest URL.
- **`routes[]` (in `routes.config.json`):** `path` valid and unique after normalization (`#order` and `#/order` collide), `app` is an existing id in `host.config.json`, optional `attributes` as above. `label` optional: a non-empty string, or a map of BCP 47 tag → non-empty string that includes the fallback language. An app may back several routes.
- **`home`:** optional. An existing app id.
- **`layout`:** **[Deferred]** optional. `layout.header.app`, when present, is an existing id. Optional `attributes` as above. Only known regions are allowed (`header`).
- **`languages`** (optional): `{ supported: string[], fallback: string }`. Every entry is a valid BCP 47 tag (`Intl.getCanonicalLocales`) and `fallback` is in `supported`. Default `{ "supported": ["vi", "en"], "fallback": "vi" }`.
- `layout` and `routes` may both be empty or absent, which is valid (F6). Without `layout.header` no header is mounted.

Two manifests ship: `host.config.json` (dev URLs) and `host.config.prod.json` (relative URLs). The deploy copies the prod one over the dev one. The route map ships the same way (see [Route map config](#route-map-config)).

### Language resolution

The app is multi-lingual: **`vi` and `en`**. The shell's `LanguageResolver` picks one language for the whole page, in this order:

1. **User choice. [Deferred]** The tag stored under `mf:language`, if it is still in `supported`. Nothing writes it in v1 (no switcher), so v1 skips this step, but the resolver keeps the input so a switcher can be added without changing it.
2. **Browser language (the default).** Walk `navigator.languages` in order. For each tag, take the first match: an exact match (`vi-VN` → `vi-VN`), otherwise the same base language (`vi-VN` → `vi`; `en-GB` → `en` if only `en` is supported).
3. **Fallback.** `languages.fallback` from the manifest, which is **`vi`**. So an unsupported browser language (e.g. `fr`) or a missing `navigator.languages` gives Vietnamese.

Behavior:
- `resolveLanguage` is pure (inputs in, tag out) and unit-tested. The `localStorage` and `navigator` reads sit behind `language-store.ts` and an injected `navigator.languages` getter, and both tolerate being unavailable.
- Resolution runs at startup, before the master (and, **[Deferred]**, the header) mounts, so the first paint is in the right language.
- **[Deferred]** **The switcher UI lives in the header app. The state lives in the shell.** On a valid `mf:language-change`, the shell stores the choice, updates `document.documentElement.lang`, re-renders its own copy (Outlet views and the header fallback), and updates `lang` on the mounted header and master. In v1 the language is fixed for the page's lifetime; the shell sets `document.documentElement.lang` and the master's `lang` once. It does not reload the page or remount anything.
- A shell string missing for a language falls back to the fallback language, then to the key, and logs a warning.
- Dates, numbers and currency are formatted by each remote with `Intl` using the `lang` it receives. The shell formats nothing business-related.

### Host internals (Mediator pattern)

One pure decision function plus I/O colleagues, as in the spike. The spike's `Header` colleague becomes a `HeaderRegion` that **mounts an app** instead of rendering links.

```
apps/shell/
  index.html                    # frame only: <div id="mf-header">, <main id="mf-outlet">
  src/
    main.ts                     # resolves DOM nodes, calls createHost().start()
    app/
      create-host.ts            # wiring only: builds colleagues + mediator, installs mf:navigate and mf:language-change listeners, dispose()
      logger.ts                 # structured logger (see Observability)
      mediator/
        types.ts                # HostEvent, HostCommand, Phase, HostState, LoadTarget
        transition.ts           # pure: (state, event) → { state, commands }; no DOM, no I/O
        host-mediator.ts        # stores state, runs transition, dispatches commands, queues re-entrant events
      router/router.ts          # hashchange → routeChanged; longest-prefix match; navigate(path)
      layout/header-region.ts   # mounts the header app into #mf-header; shell-rendered fallback + retry; updates lang/route/nav
      layout/outlet.ts          # exactly one view: home | loading | not-found | error | mounted master
    micro-frontends/
      registry.ts               # ConfigLoader (host.config.json + routes.config.json in parallel) + validateHostConfig
      loader.ts                 # ModuleLoader: import + whenDefined + timeout + retry
    i18n/
      language-resolver.ts      # pure: resolveLanguage({ stored, browser, supported, fallback }) → tag
      language-store.ts         # reads/writes the user's choice in localStorage (`mf:language`)
      messages.ts               # flat string table per supported language for shell copy (Outlet + header fallback)
apps/header/                    # the real header remote (separate spec); same anatomy as any remote
packages/contracts/src/index.ts # MF_NAVIGATE, MF_LANGUAGE_CHANGE, details, AppEntry, RouteEntry, NavItem, HostConfig
```

Rules:
- `transition.ts` has no imports from the DOM or colleagues and is unit-tested exhaustively.
- Colleagues report facts through `notify(event)` and receive commands through methods that return nothing.
- Dependencies point one way: `create-host` → mediator → colleagues. No cycles.
- **Load target.** `loader.load` takes a target: `{ kind: 'route', activationId }`, `{ kind: 'header' }` or `{ kind: 'child', parentId }`. Results come back as `appLoaded` / `appFailed` carrying the same target.
- **Route phases:** `booting → home | notFound | loadingApp → appActive | appError`, plus `fatalError`. **Header state** is tracked beside the phase (`header: none | loading | ready | failed`), so header loads never move the route phase.
- **Same-app navigation.** `routeChanged` resolving to the already-active app, in `appActive` or `loadingApp`, yields `outlet.updateRoute(hash)` and no remount or reload. Every `routeChanged` also yields `header.updateRoute(hash)` when the header is ready.
- **Stale-result guard.** Each entry into `loadingApp` gets an incrementing `activationId`. Route results with an old id (user navigated away mid-load) are ignored and logged. Header and child results never change the route phase. They only log.
- A command that throws is caught and logged. It never breaks the event queue.
- Events arriving while commands run are queued so each is handled to completion.

### Namespacing rules
Shadow DOM does not isolate the custom element registry, events, storage or `window`, so:
- Host-owned tag prefix: `mf-*`. Each remote owns its prefix (e.g. `orders-*`).
- Events use the `mf:` prefix. Storage keys use `<feature>:<key>`.
- Remotes define only their root element, guarded by `customElements.get(tag)`.
- The shell rejects duplicate tags at manifest validation. Apps shown in more than one place share one definition.

## Requirements

### Functional
| ID | Requirement |
|---|---|
| F1 | **[Deferred]** The header is a remote app loaded by the shell into `#mf-header`. It receives `lang`, `route`, `nav` and `languages`, and it highlights the active link itself. v1 has no header. |
| F2 | `#/` mounts the `home` app (v1: orders). With no `home`, it lists the routes. |
| F3 | Loading view uses `role="status"` and `aria-busy="true"`. |
| F4 | Error views use `role="alert"` and show a Retry button. Global restarts config loading and route reloads that master (and its `uses`). **[Deferred]** Header retries the header (and its `uses`) only. |
| F5 | Not-found view names the unknown hash and links home. |
| F6 | The shell works with an empty manifest (no apps, routes or layout). Home shows "No apps registered". |
| F7 | A remote that is down, slow or broken never affects the other region. A failed child never fails its parent. |
| F8 | v1: language is resolved by browser language → fallback `vi`, supports `vi` and `en`, and is passed to the master as `lang`. **[Deferred]** User choice and the header's switcher via `mf:language-change`. |
| F9 | Routes prefix-match by segment. Same-app navigation updates `route` without remounting. |
| F10 | **[Deferred]** The header mounts once and persists across route changes. Its composed widgets keep their state. |
| F11 | `uses` apps are loaded in parallel with their parent. Cycles and unknown ids are rejected at validation. |
| F12 | The same app can serve a route, a master's `uses` and (**[Deferred]**) the header's `uses`. |
| F13 | **[Deferred]** Only routes with a `label` appear in `nav`, in manifest order. |

### Non-functional
- TypeScript strict. Vite build. Vitest + happy-dom.
- Shell bundle contains no remote code and no framework (vanilla TS).
- Shell copy (Outlet views; **[Deferred]** header fallback) comes from a flat string table per supported language (`i18n/messages.ts`). No string literals in logic. (The spike is English-only, so i18n is a deliberate addition.)
- Observability: structured JSON logs on `warn`/`error` with `appId`, `target`, `activationId` and `route` fields where known. Add a W3C `traceparent` header on the manifest fetch. Remote fetch tracing is the remote's job.
- Configuration as data: the manifest URL and load timeout come from `import.meta.env` / the manifest, never hardcoded in logic.
- **[Deferred]** The header must not block the first paint of the route, and the route must not block the header.

## Repository layout

Adopts the monorepo shape of the spike. `apps/` already exists and is empty.

```
apps/
  shell/                  # this spec
  header/                 # [Deferred] header remote (separate spec)
  orders/                 # first master remote (separate spec)
packages/
  contracts/              # types + constants only
specs/
docs/
pnpm-workspace.yaml
package.json              # scripts: dev, test, typecheck, build
```

Shell `package.json` name: `@bpb/shell`. Contracts: `@bpb/contracts` (the spike's `@mf/*` scope is replaced). `notifications`, `messages`, `order-detail` and `customer-picker` in the examples are illustrative and have no specs yet.

## Testing

Per the testing-by-default rule, every module ships with a co-located `*.test.ts`:
- `transition.test.ts`: every phase × event pair, including stale ids, retry, undeclared `navigateRequested`, same-app navigation (no remount), header results not moving the route phase, child failure not failing the parent, and `header.updateRoute` on every route change.
- `registry.test.ts`: each validation error, including a duplicate tag or route path, a route or `layout.header` pointing at an unknown app, an unknown region name, a `uses` cycle, an unknown or self `uses`, reserved attribute names, a bad `label` map, relative URL resolution against the manifest URL, HTTP failure, bad JSON.
- `loader.test.ts`: already-defined tag skips import, import rejection, `whenDefined` timeout, retry cache-buster (`withRetryQuery` with and without existing query/fragment), parallel load of an app + `uses`.
- `router.test.ts`: segment-prefix matching (`#/orders/1` matches, `#/orders-archive` does not), longest match wins, empty hash, hash normalization (`#order` ≡ `#/order`), and `#order` vs `#orderv2` resolving to different apps.
- Route map loading (in `registry.test.ts`): `routesUrl` resolved against the manifest URL, both files fetched in parallel, missing `routesUrl` gives an empty route list, route-map fetch or parse failure is a global error, a route naming an app absent from `host.config.json` fails, `#order` and `#/order` collide as duplicates.
- `header-region.test.ts`: attributes set before append, `nav` built from labeled routes only, in-place `route` and `lang` updates, never unmounted on navigation, fallback and retry on failure.
- `language-resolver.test.ts`: stored choice wins; unsupported stored value ignored; browser order respected (`['fr','vi-VN']` → `vi`); exact before base match; empty or missing `navigator.languages` → fallback; invalid tags skipped.
- `language-store.test.ts`: `localStorage` throwing or unavailable still resolves.
- `outlet.test.ts`, `host-mediator.test.ts` (queueing, command failure isolation).
- `create-host.test.ts`: integration using an injected `importer` and `fetch`. Verifies the full flow, `mf:navigate` handling (valid, undeclared, malformed detail), `mf:language-change` handling (valid, unsupported) and `dispose()`.
- **Stub remotes** (test fixtures): `stub-header` (renders links from `nav`, highlights the active one, has a language `<select>` that dispatches `mf:language-change`, and composes `<stub-widget>`), `stub-widget` (keeps a counter, to prove persistence across routes), `stub-master` (renders `<stub-child>` inside its shadow root and handles `route`), and `stub-child`.

## Deployment
- Static build served from any static host. Remotes build to `remotes/<app>/<app>.js` next to the shell, and the prod manifest points at them.
- Each remote deploys independently, the header included. Updating a remote needs no shell rebuild, only a replaced file (and a manifest change if the URL is versioned).
- CI (GitHub Actions): install, typecheck, test, build on every PR.

## Milestones

Each is one vertical slice, per the change-scope rule.

1. **M1 Skeleton.** Workspace, `packages/contracts`, language resolver and string table (`vi`, `en`, fallback `vi`), shell with `transition`, mediator, Router (prefix match, `home`), Outlet (not-found), manifest validation for apps, `home`, routes and `uses`. All unit tests green. Works with an empty manifest.
2. **M2 Master route.** `ModuleLoader`, loading and error views, retry, `activationId` guard, `route` attribute and same-app navigation, `stub-master` end to end.
3. **M3 Header app. [Deferred, post-v1]** `HeaderRegion`, `nav` / `languages` / `route` / `lang` attributes, `mf:language-change`, shell fallback header with retry, `stub-header` end to end.
4. **M4 Composition.** `uses` preloading, non-fatal child failure, `lang` and events across a shadow boundary with `stub-child`. (**[Deferred]** `stub-widget` persisting across routes needs the header.)
5. **M5 Contract and polish.** `mf:navigate` listener, CSS custom property theming, structured logging, prod manifest, CI.
6. **M6 Integrate real app.** Register the real orders remote as `home` (own spec). **[Deferred]** The real header joins later.

## Acceptance

**v1 acceptance (single app, no header):**
- The page has no header. `#/` mounts the `home` app full-page.
- `/#order` and `/#/order` mount the app mapped in `routes.config.json`. `/#orderv2` mounts a different app from the same map. Editing only `routes.config.json` changes which app a hash loads.
- Browser language `vi-VN` → `lang="vi"` on the app and on `<html>`. `en-US` → `en`. `fr` or no `navigator.languages` → `vi`.
- A failing home app shows an error view with Retry. An unknown hash shows not-found with a link home.
- `pnpm test`, `pnpm typecheck` and `pnpm build` pass.

**Full design acceptance (applies once the deferred header lands):**
- With stubs, `pnpm dev` shows the stub header and home. The header lists the labeled routes only. `#/stub` mounts `<stub-master>`, which shows `<stub-child>` inside it. Leaving the route unmounts both, and the header stays.
- `#/stub/1` → `#/stub/2` keeps the same master element (no remount), updates its `route` attribute, and updates the header's active link state.
- `<stub-widget>` inside the header keeps its counter value across route changes.
- Killing the header's server: `#mf-header` shows the fallback with Retry, routes and the home list still work, and Retry mounts the header after restart. Killing the master's server: its route shows an error with Retry while the header works. Killing `stub-widget`'s server: the header still mounts and shows its own widget fallback. Killing `stub-child`'s server: the master still mounts and shows its fallback.
- With a browser language of `vi-VN` the shell loads in Vietnamese. With `fr` (unsupported) it loads in the fallback language (`vi`). Picking another language in the header updates `lang` on the header and master without a reload, and the choice survives a refresh. An `mf:language-change` with an unsupported tag is ignored.
- A manifest with a duplicate tag, a `uses` cycle, a reserved attribute name, or a route pointing at an unknown app fails startup with a single message listing all errors.
- Rapidly switching routes mid-load never mounts the wrong app.
- `pnpm test`, `pnpm typecheck` and `pnpm build` pass.

## Open questions
1. Hash routing (as in the spike) or History API routing? Hash needs no server rewrites. History API gives cleaner URLs, but needs a fallback rule on the static host. Prefix matching works for both.
2. ~~Which languages ship in v1?~~ **Decided:** `vi` and `en`, browser language, fallback `vi`.
3. On-demand child loading: should a parent be able to request an app that was not in its `uses` (e.g. via an `mf:load-app` event)? v1 says no, because declared `uses` keeps the load graph visible. Is that enough for lazily opened panels?
4. Other regions (sidebar, footer, a global modal host)? v1 has only `header`. Adding a region is a shell code change plus a `layout` key.
5. Should the shell pass the header any more data than `nav`, `languages`, `route` and `lang`, such as user or tenant info? The spec says no until authentication is in scope.
