# Plan: Micro-Frontend Host (Shell), v1

Spec: [specs/2026-11-19-micro-frontend-host.spec.md](../../specs/2026-11-19-micro-frontend-host.spec.md)
Scope: **v1 only** (single app, no header). Milestones M1, M2, M4 (minus header-dependent parts), M5. M3 and M6 are out of scope.

## Out of scope (building any of these is a blocker)
`HeaderRegion`, header fallback, `#mf-header`, `nav` / `languages` attributes, `mf:language-change` handling, language switcher, `layout` region, `stub-header`, `stub-widget`, `apps/header`, `apps/orders`, user-choice step in language resolution (the resolver keeps the `stored` input but nothing writes it), Module Federation, import maps, the real orders remote.

Contract types for deferred items (`nav`, `languages`, `mf:language-change`, `layout.header`) may be declared in `packages/contracts` as reserved, with no runtime behavior.

## Decisions taken from the spec (no user input needed)
- Unknown hash shows not-found with a link home. `docs/micro-frontend-host-main-flow.md` mentions a "default app when no route matches" fallback. The spec has no such rule, so the spec wins and that fallback is not built.
- Stack: pnpm workspace, TypeScript strict, Vite, Vitest + happy-dom, vanilla TS, no framework in the shell.
- Packages: `@bpb/shell` (`apps/shell`), `@bpb/contracts` (`packages/contracts`).

## Tasks

Each task ships co-located `*.test.ts`. Workers do not commit. Orchestrator commits one task at a time.

| ID | Title | Spec sections | File scope | Depends on | Parallel group |
|---|---|---|---|---|---|
| T1 | Workspace scaffold and contracts | Repository layout, Integration contract, Non-functional | `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `packages/contracts/**`, `apps/shell/package.json`, `apps/shell/tsconfig.json`, `apps/shell/vite.config.ts`, `apps/shell/vitest.config.ts`, `apps/shell/.env*` | none | A |
| T2 | i18n: LanguageResolver, store, messages | Language resolution, F8 | `apps/shell/src/i18n/**` | T1 | B |
| T3 | Registry: config loading and validation | Manifest, Route map config, Validation | `apps/shell/src/micro-frontends/registry.ts`, `registry.test.ts`, `apps/shell/public/host.config*.json`, `apps/shell/public/routes.config*.json` | T1 | B |
| T4 | Router | Routing, F9 | `apps/shell/src/app/router/**` | T1 | B |
| T5 | Mediator: types, pure transition, HostMediator | Host internals, Runtime flow steps 5-7 | `apps/shell/src/app/mediator/**` | T1 | B |
| T6 | ModuleLoader | Runtime flow step 4, Failures, Retry | `apps/shell/src/micro-frontends/loader.ts`, `loader.test.ts` | T1 | B |
| T7 | Outlet | F3, F4, F5, F6, F2 | `apps/shell/src/app/layout/outlet.ts`, `outlet.test.ts` | T2, T5 | C |
| T8 | create-host, main, logger, index.html | Runtime flow, Contract, Observability, F7 | `apps/shell/src/main.ts`, `apps/shell/src/app/create-host.ts`, `create-host.test.ts`, `apps/shell/src/app/logger.ts`, `logger.test.ts`, `apps/shell/index.html` | T2-T7 | D |
| T9 | Composition: `uses` and stub remotes | Composition, F11, F12, M4 | `apps/shell/src/test-fixtures/**` (`stub-master`, `stub-child`), additions to `create-host.test.ts` and `loader.test.ts` only if T8's files are untouched by others | T8 | E |
| T10 | Contract and polish | M5, Deployment | CSS custom properties in `apps/shell/index.html` / `src/styles.css`, `traceparent` on manifest fetch (`registry.ts`), prod manifests, `.github/workflows/ci.yml`, root scripts | T9 | F |

Parallel groups: T2, T3, T4, T5, T6 have disjoint file scopes and run together after T1. T7 follows T2+T5. T8, T9, T10 are sequential because they share `create-host.ts` and `registry.ts`.

## Acceptance criteria per task

**T1.** `pnpm install`, `pnpm typecheck`, `pnpm test`, `pnpm build` run (even with few tests). Contracts export only types and constants (`MF_NAVIGATE`, reserved `MF_LANGUAGE_CHANGE`, `NavigateDetail`, `AppEntry`, `RouteEntry`, `HostConfig`, `RoutesConfig`, shell-owned attribute names). No runtime behavior in contracts. TS strict.

**T2.** `resolveLanguage` is pure. Tests cover: stored choice wins; unsupported stored value ignored; `['fr','vi-VN']` → `vi`; exact before base match; empty or missing `navigator.languages` → fallback; invalid tags skipped. `language-store` tolerates a throwing or missing `localStorage`. `messages.ts` has `vi` and `en` string tables, with fallback to the fallback language, then to the key, and a logged warning.

**T3.** `ConfigLoader` fetches `host.config.json` and the `routesUrl` file in parallel (`cache: 'no-cache'`). `routesUrl` resolves against the manifest URL. Missing `routesUrl` gives an empty route list. Route-map fetch or parse failure is a global error. `validateHostConfig` collects all errors and reports them together. Each rule from the spec's Validation list has a test, including: duplicate tag, duplicate route path after normalization (`#order` vs `#/order`), unknown app in route or `home`, `uses` cycle, unknown or self `uses`, reserved attribute names, bad `label` map, relative URL resolution, HTTP failure, bad JSON. Unknown fields are dropped. `layout` is not accepted or built in v1 (unknown field, dropped). Empty manifest is valid (F6).

**T4.** Hash normalization (`#order` ≡ `#/order`). Segment-prefix matching (`#/orders/1` matches, `#/orders-archive` does not). Longest match wins. Empty hash and `#` mean `#/`. `#order` and `#orderv2` resolve to different apps. `navigate(path)` sets the hash. Accepts `#/` or declared routes only.

**T5.** `transition.ts` is pure with no DOM or colleague imports. Phases: `booting → home | notFound | loadingApp → appActive | appError`, plus `fatalError`. Increasing `activationId` with a stale-result guard. Same-app navigation yields `outlet.updateRoute(hash)` and no remount. Retry. Undeclared `navigateRequested` ignored and logged. Child results never move the route phase. Every phase × event pair tested. `HostMediator` queues re-entrant events and isolates throwing commands. No header state or header commands in v1.

**T6.** Already-defined tag skips import. Otherwise `import(url)` plus `customElements.whenDefined(tag)` raced against a timeout (default 10 s, injectable). `withRetryQuery` appends `?retry=<n>` keeping existing query and fragment. An app and its `uses` load in parallel. Targets: `{ kind: 'route', activationId }`, `{ kind: 'child', parentId }`. Results come back as `appLoaded` / `appFailed` carrying the same target. Injected `importer`.

**T7.** Exactly one view at a time: home (route list, or "No apps registered"), loading (`role="status"`, `aria-busy="true"`), not-found (names the unknown hash, link home), error (`role="alert"`, Retry button), mounted master. Mounting creates the element, sets attributes before `append` (merge order: app `attributes`, route `attributes`, shell-owned `lang` and `route`), removes the old element on a different app, `updateRoute` updates the `route` attribute in place. All copy from `messages.ts`.

**T8.** `createHost({ importer, fetch, navigatorLanguages, ... }).start()` runs the full flow with injectable dependencies. Sets `document.documentElement.lang` and `lang` on the master. One `window` listener for `mf:navigate` (valid, undeclared, malformed detail). `dispose()` removes listeners and unmounts. Global failure shows an error panel with Retry that restarts config loading. Structured JSON logs on `warn` / `error` with `appId`, `target`, `activationId`, `route` where known. No `mf:language-change` listener.

**T9.** `stub-master` renders `<stub-child>` inside its shadow root, forwards `lang`, handles `route`. `stub-child` may be killed independently. A failed `uses` app logs a warning and never fails the parent. `uses` is not transitive. Events with `bubbles: true, composed: true` cross the shadow boundary to `window`. Integration tests cover: child failure non-fatal, same-app navigation keeps the same element, rapid route switching never mounts the wrong app.

**T10.** CSS custom properties declared on `:root` (`--mf-color-primary`, `--mf-font-family`). `traceparent` header on the manifest fetch. `host.config.prod.json` and `routes.config.prod.json` with relative URLs. CI workflow: install, typecheck, test, build on every PR. Manifest URL and load timeout come from `import.meta.env` or the manifest.

## Integration (after T10)
Run `pnpm test`, `pnpm typecheck`, `pnpm build`. One final reviewer checks the whole diff against the whole spec, with special attention to `[Deferred]` leakage. Verify the v1 acceptance list:
- No header. `#/` mounts the `home` app full-page.
- `/#order`, `/#/order` and `/#orderv2` map through `routes.config.json`.
- `vi-VN` → `vi`, `en-US` → `en`, `fr` or none → `vi` on the app and on `<html>`.
- A failing home app shows an error with Retry. An unknown hash shows not-found with a link home.

## Commit convention
`feat(shell): <task title>` (`chore` for T1, `ci` portions of T10). Body line: `Spec: 2026-11-19-micro-frontend-host.spec.md, task Tn`. One commit per approved task. No push.
