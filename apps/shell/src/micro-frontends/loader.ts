export interface LoadApp {
  id: string;
  url: string;
  tag: string;
}

export type LoadTarget =
  | { kind: 'route'; activationId: number }
  | { kind: 'child'; parentId: string };

export type LoaderEvent =
  | { type: 'appLoaded'; target: LoadTarget; appId: string }
  | { type: 'appFailed'; target: LoadTarget; appId: string; error: LoadError };

export type LogLevel = 'info' | 'warn' | 'error';
export type LoaderLog = (level: LogLevel, event: string, fields: Record<string, unknown>) => void;

export type LoadErrorKind = 'import' | 'timeout';

export class LoadError extends Error {
  readonly kind: LoadErrorKind;
  constructor(kind: LoadErrorKind, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'LoadError';
    this.kind = kind;
  }
}

export interface LoadRequest {
  app: LoadApp;
  uses: LoadApp[];
  target: LoadTarget;
  retry?: number;
}

export interface ModuleLoaderOptions {
  importer?: (url: string) => Promise<unknown>;
  customElementsRegistry?: Pick<CustomElementRegistry, 'get' | 'whenDefined'>;
  timeoutMs?: number;
  log?: LoaderLog;
  notify: (event: LoaderEvent) => void;
}

export interface ModuleLoader {
  loadApp(app: LoadApp, retry?: number): Promise<void>;
  load(request: LoadRequest): void;
}

export const DEFAULT_LOAD_TIMEOUT_MS = 10000;

/** Appends/replaces `retry=<n>` keeping existing query and fragment. Retry 0/undefined leaves url unchanged. */
export function withRetryQuery(url: string, retry?: number): string {
  if (!retry) return url;
  const hashIdx = url.indexOf('#');
  const fragment = hashIdx >= 0 ? url.slice(hashIdx) : '';
  const beforeHash = hashIdx >= 0 ? url.slice(0, hashIdx) : url;
  const qIdx = beforeHash.indexOf('?');
  const path = qIdx >= 0 ? beforeHash.slice(0, qIdx) : beforeHash;
  const query = qIdx >= 0 ? beforeHash.slice(qIdx + 1) : '';
  const params = query.split('&').filter((p) => p !== '' && p.split('=')[0] !== 'retry');
  params.push(`retry=${retry}`);
  return `${path}?${params.join('&')}${fragment}`;
}

export function createModuleLoader(options: ModuleLoaderOptions): ModuleLoader {
  const importer = options.importer ?? ((url: string) => import(/* @vite-ignore */ url));
  const registry = options.customElementsRegistry ?? window.customElements;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
  const log: LoaderLog = options.log ?? (() => {});

  async function loadApp(app: LoadApp, retry?: number): Promise<void> {
    if (registry.get(app.tag) !== undefined) return;
    const url = withRetryQuery(app.url, retry);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new LoadError('timeout', `<${app.tag}> not defined within ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    const imported = (async () => {
      try {
        await importer(url);
      } catch (cause) {
        throw new LoadError('import', `import failed for ${app.id}`, { cause });
      }
      await registry.whenDefined(app.tag);
    })();
    imported.catch(() => {}); // avoid unhandled rejection if the timeout wins
    try {
      await Promise.race([imported, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  function toLoadError(e: unknown): LoadError {
    return e instanceof LoadError ? e : new LoadError('import', String(e), { cause: e });
  }

  function run(app: LoadApp, target: LoadTarget, retry: number | undefined): void {
    const isChild = target.kind === 'child';
    const safeNotify = (event: LoaderEvent): void => {
      try {
        options.notify(event);
      } catch (e) {
        log('error', 'notifyFailed', { appId: app.id, target, message: String(e) });
      }
    };
    loadApp(app, retry).then(
      () => safeNotify({ type: 'appLoaded', target, appId: app.id }),
      (e: unknown) => {
        const error = toLoadError(e);
        log(isChild ? 'warn' : 'error', 'appLoadFailed', {
          appId: app.id,
          target,
          kind: error.kind,
          message: error.message,
          ...(target.kind === 'route' ? { activationId: target.activationId } : {}),
        });
        safeNotify({ type: 'appFailed', target, appId: app.id, error });
      },
    );
  }

  function load({ app, uses, target, retry }: LoadRequest): void {
    run(app, target, retry);
    // `uses` is not transitive: only the given children are loaded.
    for (const child of uses) run(child, { kind: 'child', parentId: app.id }, retry);
  }

  return { loadApp, load };
}
