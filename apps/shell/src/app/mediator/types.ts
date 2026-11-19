/** Plain, already-validated config the mediator needs. No DOM, no I/O. */
export interface ResolvedRoute {
  readonly path: string;
  readonly app: string;
  readonly attributes?: Readonly<Record<string, string>>;
}

export interface ResolvedApp {
  readonly id: string;
  readonly uses: readonly string[];
}

export interface ResolvedConfig {
  readonly home?: string;
  readonly apps: readonly ResolvedApp[];
  readonly routes: readonly ResolvedRoute[];
}

export type LoadTarget =
  | { readonly kind: 'route'; readonly activationId: number }
  | { readonly kind: 'child'; readonly parentId: string };

export type Phase =
  | 'booting'
  | 'home'
  | 'notFound'
  | 'loadingApp'
  | 'appActive'
  | 'appError'
  | 'fatalError';

export interface HostState {
  readonly phase: Phase;
  readonly config: ResolvedConfig | null;
  readonly lang: string | null;
  /** Last hash seen (raw, as given by the router). */
  readonly hash: string;
  /** App currently loading or mounted in the Outlet. */
  readonly activeApp: string | null;
  /** Route attributes of the active app's route. */
  readonly activeAttributes: Readonly<Record<string, string>> | undefined;
  /** Incremented on every entry into loadingApp. */
  readonly activationId: number;
  /** Retry count for the current activation (0 = first try). */
  readonly retry: number;
  /** Retry count for the global config load. */
  readonly configRetry: number;
}

export type HostEvent =
  | { readonly type: 'started' }
  | { readonly type: 'configLoaded'; readonly config: ResolvedConfig; readonly lang: string }
  | { readonly type: 'configFailed'; readonly errors: readonly string[] }
  | { readonly type: 'routeChanged'; readonly hash: string }
  | { readonly type: 'appLoaded'; readonly target: LoadTarget; readonly appId?: string }
  | {
      readonly type: 'appFailed';
      readonly target: LoadTarget;
      readonly appId?: string;
      readonly error: string;
    }
  | { readonly type: 'retryRequested' }
  | { readonly type: 'navigateRequested'; readonly path: string };

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type HostCommand =
  | { readonly kind: 'config.load'; readonly retry: number }
  | { readonly kind: 'outlet.showLoading' }
  | { readonly kind: 'outlet.showHome'; readonly routes: readonly ResolvedRoute[] }
  | { readonly kind: 'outlet.showNotFound'; readonly hash: string }
  | {
      readonly kind: 'outlet.showError';
      readonly scope: 'global' | 'route';
      readonly errors: readonly string[];
      readonly hash: string;
    }
  | {
      readonly kind: 'outlet.mount';
      readonly app: string;
      readonly attributes: Readonly<Record<string, string>> | undefined;
      readonly hash: string;
    }
  | { readonly kind: 'outlet.updateRoute'; readonly hash: string }
  | {
      readonly kind: 'loader.load';
      readonly app: string;
      readonly uses: readonly string[];
      readonly target: LoadTarget;
      readonly retry: number;
    }
  | { readonly kind: 'router.navigate'; readonly path: string }
  | {
      readonly kind: 'log';
      readonly level: LogLevel;
      readonly event: string;
      readonly fields?: Readonly<Record<string, unknown>>;
    };

export interface TransitionResult {
  readonly state: HostState;
  readonly commands: readonly HostCommand[];
}
