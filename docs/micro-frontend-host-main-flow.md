# Shell Main Flow (v1)

Source: [specs/2026-11-19-micro-frontend-host.spec.md](../specs/2026-11-19-micro-frontend-host.spec.md), "Runtime flow" and "Host internals (Mediator pattern)".

## 1. Startup and first route (happy path)

```mermaid
sequenceDiagram
    autonumber
    participant Main as main.ts / create-host
    participant Reg as ConfigLoader (registry)
    participant Lang as LanguageResolver
    participant Med as HostMediator (+ transition)
    participant Router
    participant Loader as ModuleLoader
    participant Outlet
    participant App as Remote app (custom element)

    Main->>Reg: load host.config.json + routes.config.json (parallel)
    Reg-->>Main: validated HostConfig (or fatalError)
    Main->>Lang: resolveLanguage(browser, supported, fallback)
    Lang-->>Main: "vi" | "en" (sets html lang)
    Main->>Med: start()
    Med->>Router: read location.hash
    Router-->>Med: routeChanged(home, matched route, or default app from routes.config.json when no route matches)
    Med->>Outlet: showLoading()
    Med->>Loader: load(app + uses, target: route, activationId)
    Loader->>Loader: tag defined? skip : import(url) + whenDefined, 10 s timeout
    Loader-->>Med: appLoaded(target)
    Med->>Outlet: mount(app, lang, route, attributes)
    Outlet->>App: create, set attributes, append
    Note over App: attributes down, mf: events up
    App-->>Main: mf:navigate (window listener)
    Main->>Med: navigateRequested(path)
    Med->>Router: navigate(path) sets hash, loop to routeChanged
```

## 2. Route phases (mediator state)

```mermaid
stateDiagram-v2
    [*] --> booting
    booting --> fatalError: config fetch / validation fails
    fatalError --> booting: Retry
    booting --> home: hash is #/ and no home app
    booting --> notFound: no route matches and no default app
    booting --> loadingApp: home app, route matched, or default app (no route matches)

    home --> loadingApp: routeChanged
    notFound --> loadingApp: routeChanged
    loadingApp --> appActive: appLoaded (same activationId)
    loadingApp --> appError: appFailed (same activationId)
    loadingApp --> loadingApp: routeChanged (new activationId, stale result ignored)
    appError --> loadingApp: Retry (?retry=n)
    appActive --> appActive: same-app hashchange (update route, no remount)
    appActive --> loadingApp: different app
    appActive --> notFound: unknown hash and no default app
```

Child (`uses`) failures never change the phase. They only log a warning, and the parent renders its own fallback.
