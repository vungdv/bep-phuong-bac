import { MF_NAVIGATE } from '@bpb/contracts';
import type { Label } from '@bpb/contracts';
import { getBrowserLanguages } from '../i18n/language-store';
import { resolveLanguage } from '../i18n/language-resolver';
import { createTranslator } from '../i18n/messages';
import { ConfigError, ConfigLoader, DEFAULT_LANGUAGES } from '../micro-frontends/registry';
import type { ResolvedConfig as RegistryConfig } from '../micro-frontends/registry';
import { createModuleLoader } from '../micro-frontends/loader';
import type { LoadApp, ModuleLoader } from '../micro-frontends/loader';
import { createOutlet } from './layout/outlet';
import type { Outlet } from './layout/outlet';
import { createLogger } from './logger';
import type { Logger } from './logger';
import { HostMediator } from './mediator/host-mediator';
import { initialState } from './mediator/transition';
import type { HostCommand, ResolvedConfig as MediatorConfig } from './mediator/types';
import { createRouter } from './router/router';
import type { Router } from './router/router';

export interface CreateHostOptions {
  /** Element that hosts the Outlet. Defaults to `#mf-outlet`. */
  root?: HTMLElement;
  /** Manifest URL. Defaults to `import.meta.env.VITE_MANIFEST_URL`. */
  manifestUrl?: string;
  fetch?: typeof fetch;
  importer?: (url: string) => Promise<unknown>;
  /** Source of `navigator.languages`. */
  getBrowserLanguages?: () => readonly string[];
  window?: Window;
  /** Per-app load timeout. Defaults to `import.meta.env.VITE_LOAD_TIMEOUT_MS`. */
  loadTimeoutMs?: number;
  /** Lets the route map be fetched in parallel with the manifest. */
  routesUrlHint?: string;
  logger?: Logger;
}

export interface Host {
  start(): void;
  dispose(): void;
}

export const DEFAULT_ROUTES_URL_HINT = './routes.config.json';

function envTimeout(): number | undefined {
  const n = Number(import.meta.env?.VITE_LOAD_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function labelFor(label: Label | undefined, lang: string, fallback: string): string | undefined {
  if (label === undefined || typeof label === 'string') return label;
  return label[lang] ?? label[fallback];
}

function toMediatorConfig(config: RegistryConfig): MediatorConfig {
  const base = {
    apps: Object.entries(config.apps).map(([id, app]) => ({ id, uses: app.uses })),
    routes: config.routes.map((r) => ({ path: r.path, app: r.app, attributes: r.attributes })),
  };
  return config.home === undefined ? base : { ...base, home: config.home };
}

/**
 * Wiring only: builds the colleagues (config loader, module loader, router, outlet), the mediator,
 * the `mf:navigate` listener and `dispose()`. Decisions live in the mediator's pure transition.
 *
 * Startup order: the Outlet first uses the default languages (vi, en; fallback vi) resolved from the
 * browser, so loading and global-error views are translated before the manifest is known. Once the
 * config loads, the language is resolved again with the configured languages, `<html lang>` is set,
 * and the Outlet is rebuilt once with the final translator and `lang`. The language is then fixed.
 * The router is created and started just before `configLoaded` is notified, so its first
 * `routeChanged` only stores the hash (config is still null) and `configLoaded` mounts exactly once.
 */
export function createHost(options: CreateHostOptions = {}): Host {
  const win = options.window ?? window;
  const doc = win.document;
  const logger = options.logger ?? createLogger();
  const browserLanguages = options.getBrowserLanguages ?? (() => getBrowserLanguages());
  const manifestUrl = options.manifestUrl ?? import.meta.env?.VITE_MANIFEST_URL;
  const routesUrlHint = options.routesUrlHint ?? DEFAULT_ROUTES_URL_HINT;

  let disposed = false;
  let started = false;
  let outlet: Outlet | undefined;
  let router: Router | undefined;
  let config: RegistryConfig | undefined;
  let lang = DEFAULT_LANGUAGES.fallback;
  let fallback = DEFAULT_LANGUAGES.fallback;

  const mediator: HostMediator = new HostMediator({
    initialState,
    dispatch: (command) => run(command),
    log: (level, event, fields) => logger.log(level, event, fields),
  });

  const loader: ModuleLoader = createModuleLoader({
    ...(options.importer ? { importer: options.importer } : {}),
    ...(options.loadTimeoutMs !== undefined || envTimeout() !== undefined
      ? { timeoutMs: options.loadTimeoutMs ?? (envTimeout() as number) }
      : {}),
    log: (level, event, fields) => logger.log(level, event, fields),
    notify: (event) => {
      if (disposed) return;
      if (event.type === 'appLoaded') {
        mediator.notify({ type: 'appLoaded', target: event.target, appId: event.appId });
      } else {
        mediator.notify({
          type: 'appFailed',
          target: event.target,
          appId: event.appId,
          error: event.error.message,
        });
      }
    },
  });

  function buildOutlet(root: HTMLElement, l: string, fb: string): Outlet {
    const t = createTranslator({
      lang: l,
      fallback: fb,
      warn: (message) => logger.log('warn', 'i18n.missing', { message }),
    });
    return createOutlet({
      root,
      t,
      lang: l,
      onRetry: () => mediator.notify({ type: 'retryRequested' }),
    });
  }

  function loadApp(id: string): LoadApp {
    const app = config?.apps[id];
    if (!app) throw new Error(`unknown app "${id}"`);
    return { id, url: app.url, tag: app.tag };
  }

  async function loadConfig(): Promise<void> {
    const root = options.root ?? doc.getElementById('mf-outlet');
    let ready: { mediatorConfig: MediatorConfig } | undefined;
    try {
      if (!manifestUrl) throw new ConfigError(['VITE_MANIFEST_URL is not set']);
      const configLoader = new ConfigLoader({
        ...(options.fetch ? { fetch: options.fetch } : {}),
        routesUrlHint,
        baseUrl: win.location.href,
      });
      const loaded = await configLoader.load(manifestUrl);
      if (disposed) return;
      config = loaded;
      fallback = loaded.languages.fallback;
      lang = resolveLanguage({
        stored: null, // v1: nothing writes the user's choice; the resolver keeps the input.
        browser: browserLanguages(),
        supported: loaded.languages.supported,
        fallback,
      });
      doc.documentElement.setAttribute('lang', lang);
      if (root) {
        outlet?.dispose();
        outlet = buildOutlet(root, lang, fallback);
      }
      router?.dispose();
      router = createRouter({
        routes: loaded.routes,
        onRouteChanged: (hash) => {
          if (!disposed) mediator.notify({ type: 'routeChanged', hash });
        },
        deps: {
          getHash: () => win.location.hash,
          setHash: (hash) => {
            win.location.hash = hash;
          },
          addHashListener: (listener) => {
            win.addEventListener('hashchange', listener);
            return () => win.removeEventListener('hashchange', listener);
          },
        },
      });
      router.start(); // stores the hash only: config is not yet in the mediator state
      ready = { mediatorConfig: toMediatorConfig(loaded) };
    } catch (error) {
      if (disposed) return;
      const errors =
        error instanceof ConfigError ? error.errors : [error instanceof Error ? error.message : String(error)];
      mediator.notify({ type: 'configFailed', errors });
      return;
    }
    // Outside the try: a failure here is not a config failure and must not be reported as one.
    if (ready && !disposed) mediator.notify({ type: 'configLoaded', config: ready.mediatorConfig, lang });
  }

  function run(command: HostCommand): void {
    switch (command.kind) {
      case 'config.load':
        void loadConfig();
        return;
      case 'outlet.showLoading':
        outlet?.showLoading();
        return;
      case 'outlet.showHome':
        outlet?.showHome(
          command.routes.map((r) => {
            const label = labelFor(
              config?.routes.find((c) => c.path === r.path)?.label,
              lang,
              fallback,
            );
            return label === undefined ? { path: r.path } : { path: r.path, label };
          }),
        );
        return;
      case 'outlet.showNotFound':
        outlet?.showNotFound(command.hash);
        return;
      case 'outlet.showError':
        outlet?.showError(command.scope, command.errors);
        return;
      case 'outlet.mount': {
        const app = config?.apps[command.app];
        if (!app) throw new Error(`unknown app "${command.app}"`);
        outlet?.mount({
          tag: app.tag,
          attributes: { ...app.attributes, ...command.attributes },
          hash: command.hash,
        });
        return;
      }
      case 'outlet.updateRoute':
        outlet?.updateRoute(command.hash);
        return;
      case 'loader.load':
        loader.load({
          app: loadApp(command.app),
          uses: command.uses.map(loadApp),
          target: command.target,
          retry: command.retry,
        });
        return;
      case 'router.navigate':
        if (!router?.navigate(command.path)) {
          logger.log('warn', 'navigate.rejected', { path: command.path });
        }
        return;
      case 'log':
        logger.log(command.level, command.event, command.fields);
        return;
    }
  }

  const onNavigate = (event: Event): void => {
    const detail = (event as CustomEvent<unknown>).detail as { path?: unknown } | null | undefined;
    const path = detail?.path;
    if (typeof path !== 'string') {
      logger.log('warn', 'navigate.malformed', { detail: typeof detail });
      return;
    }
    mediator.notify({ type: 'navigateRequested', path });
  };

  return {
    start() {
      if (started || disposed) return;
      started = true;
      const root = options.root ?? doc.getElementById('mf-outlet');
      if (!root) throw new Error('createHost: no root element (#mf-outlet) found');
      const defaults = DEFAULT_LANGUAGES;
      lang = resolveLanguage({
        stored: null,
        browser: browserLanguages(),
        supported: defaults.supported,
        fallback: defaults.fallback,
      });
      doc.documentElement.setAttribute('lang', lang); // first paint in the right language
      outlet = buildOutlet(root, lang, defaults.fallback);
      win.addEventListener(MF_NAVIGATE, onNavigate);
      mediator.notify({ type: 'started' });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      win.removeEventListener(MF_NAVIGATE, onNavigate);
      router?.dispose();
      outlet?.dispose();
    },
  };
}
