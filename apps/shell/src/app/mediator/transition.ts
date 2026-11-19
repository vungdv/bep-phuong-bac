import { matchRoute, normalizeHash } from './route-match';
import type {
  HostCommand,
  HostEvent,
  HostState,
  LoadTarget,
  LogLevel,
  ResolvedConfig,
  TransitionResult,
} from './types';

export const initialState: HostState = {
  phase: 'booting',
  config: null,
  lang: null,
  hash: '#/',
  activeApp: null,
  activeAttributes: undefined,
  activationId: 0,
  retry: 0,
  configRetry: 0,
};

const log = (
  level: LogLevel,
  event: string,
  fields?: Record<string, unknown>,
): HostCommand => (fields ? { kind: 'log', level, event, fields } : { kind: 'log', level, event });

const ignore = (
  state: HostState,
  event: string,
  fields: Record<string, unknown>,
): TransitionResult => ({ state, commands: [log('info', event, { phase: state.phase, ...fields })] });

type Resolution =
  | { kind: 'app'; app: string; attributes: Readonly<Record<string, string>> | undefined }
  | { kind: 'home' }
  | { kind: 'notFound' };

function resolve(hash: string, config: ResolvedConfig): Resolution {
  const n = normalizeHash(hash);
  if (n === '#/') {
    return config.home ? { kind: 'app', app: config.home, attributes: undefined } : { kind: 'home' };
  }
  const route = matchRoute(n, config.routes);
  return route ? { kind: 'app', app: route.app, attributes: route.attributes } : { kind: 'notFound' };
}

function startLoading(
  state: HostState,
  app: string,
  attributes: Readonly<Record<string, string>> | undefined,
  retry: number,
): TransitionResult {
  const activationId = state.activationId + 1;
  const next: HostState = {
    ...state,
    phase: 'loadingApp',
    activeApp: app,
    activeAttributes: attributes,
    activationId,
    retry,
  };
  const uses = state.config?.apps.find((a) => a.id === app)?.uses ?? [];
  return {
    state: next,
    commands: [
      { kind: 'outlet.showLoading' },
      {
        kind: 'loader.load',
        app,
        uses,
        target: { kind: 'route', activationId },
        retry,
      },
    ],
  };
}

function route(state: HostState, hash: string): TransitionResult {
  const config = state.config;
  const withHash: HostState = { ...state, hash };
  if (!config) return { state: withHash, commands: [] };
  const res = resolve(hash, config);
  if (res.kind === 'app') {
    const sameApp =
      state.activeApp === res.app &&
      (state.phase === 'appActive' || state.phase === 'loadingApp');
    if (sameApp) {
      return {
        state: { ...withHash, activeAttributes: res.attributes },
        commands: [{ kind: 'outlet.updateRoute', hash }],
      };
    }
    return startLoading(withHash, res.app, res.attributes, 0);
  }
  const cleared: HostState = { ...withHash, activeApp: null, activeAttributes: undefined };
  if (res.kind === 'home') {
    return {
      state: { ...cleared, phase: 'home' },
      commands: [{ kind: 'outlet.showHome', routes: config.routes }],
    };
  }
  return {
    state: { ...cleared, phase: 'notFound' },
    commands: [{ kind: 'outlet.showNotFound', hash }],
  };
}

function targetFields(target: LoadTarget): Record<string, unknown> {
  return target.kind === 'route'
    ? { target: 'route', activationId: target.activationId }
    : { target: 'child', parentId: target.parentId };
}

function onResult(
  state: HostState,
  event: Extract<HostEvent, { type: 'appLoaded' | 'appFailed' }>,
): TransitionResult {
  const { target } = event;
  const failed = event.type === 'appFailed';
  const error = event.type === 'appFailed' ? event.error : undefined;
  const base = { appId: event.appId, route: state.hash, ...targetFields(target) };

  if (target.kind === 'child') {
    return {
      state,
      commands: [
        failed
          ? log('warn', 'child.failed', { ...base, error })
          : log('info', 'child.loaded', base),
      ],
    };
  }
  if (state.phase !== 'loadingApp' || target.activationId !== state.activationId) {
    return ignore(state, 'route.result.stale', {
      ...base,
      current: state.activationId,
      failed,
    });
  }
  if (!failed) {
    return {
      state: { ...state, phase: 'appActive' },
      commands: [
        {
          kind: 'outlet.mount',
          app: state.activeApp ?? '',
          attributes: state.activeAttributes,
          hash: state.hash,
        },
      ],
    };
  }
  return {
    state: { ...state, phase: 'appError' },
    commands: [
      log('error', 'route.failed', { ...base, error }),
      {
        kind: 'outlet.showError',
        scope: 'route',
        errors: [error ?? 'unknown error'],
        hash: state.hash,
      },
    ],
  };
}

export function transition(state: HostState, event: HostEvent): TransitionResult {
  switch (event.type) {
    case 'started':
      if (state.phase !== 'booting') return ignore(state, 'started.ignored', {});
      return {
        state,
        commands: [{ kind: 'outlet.showLoading' }, { kind: 'config.load', retry: state.configRetry }],
      };

    case 'configLoaded':
      if (state.phase !== 'booting') return ignore(state, 'configLoaded.ignored', {});
      return route({ ...state, config: event.config, lang: event.lang }, state.hash);

    case 'configFailed':
      if (state.phase !== 'booting') return ignore(state, 'configFailed.ignored', {});
      return {
        state: { ...state, phase: 'fatalError' },
        commands: [
          log('error', 'config.failed', { errors: event.errors }),
          { kind: 'outlet.showError', scope: 'global', errors: event.errors, hash: state.hash },
        ],
      };

    case 'routeChanged':
      return route(state, event.hash);

    case 'appLoaded':
    case 'appFailed':
      return onResult(state, event);

    case 'retryRequested':
      if (state.phase === 'fatalError') {
        const configRetry = state.configRetry + 1;
        return {
          state: { ...state, phase: 'booting', configRetry },
          commands: [{ kind: 'outlet.showLoading' }, { kind: 'config.load', retry: configRetry }],
        };
      }
      if (state.phase === 'appError' && state.activeApp) {
        return startLoading(state, state.activeApp, state.activeAttributes, state.retry + 1);
      }
      return ignore(state, 'retry.ignored', {});

    case 'navigateRequested': {
      const { path } = event;
      const valid =
        typeof path === 'string' &&
        path.startsWith('#') &&
        state.config !== null &&
        (normalizeHash(path) === '#/' || matchRoute(path, state.config.routes) !== undefined);
      if (valid) return { state, commands: [{ kind: 'router.navigate', path }] };
      return { state, commands: [log('warn', 'navigate.ignored', { path })] };
    }
  }
}
