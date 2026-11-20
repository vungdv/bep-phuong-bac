/** Thrown for every non-2xx answer; `status` is 0 for network failures and timeouts. */
export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
  }
}

export interface HttpClientOptions {
  fetch?: typeof fetch;
  /** Bearer token source; no header is sent when it returns undefined. */
  getToken?: () => Promise<string | undefined>;
  /** Per-attempt timeout (default 10 s). */
  timeoutMs?: number;
  /** Retries for idempotent requests only (default 2). */
  maxRetries?: number;
  /** Base of the exponential backoff (default 200 ms). */
  backoffMs?: number;
  /** Test seams. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface RequestOptions {
  body?: unknown;
  /** Safe to repeat: enables retry on network error, 5xx and 429. Never set for the update POST. */
  idempotent?: boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Small fetch wrapper: timeout, bearer token, JSON in/out, retry with backoff for idempotent calls. */
export class HttpClient {
  private readonly fetchImpl: typeof fetch;
  private readonly getToken: () => Promise<string | undefined>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly backoffMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly random: () => number;

  constructor(options: HttpClientOptions = {}) {
    this.fetchImpl = options.fetch ?? ((...args) => globalThis.fetch(...args));
    this.getToken = options.getToken ?? (async () => undefined);
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.backoffMs = options.backoffMs ?? 200;
    this.sleep = options.sleep ?? defaultSleep;
    this.random = options.random ?? Math.random;
  }

  async request<T>(method: string, url: string, options: RequestOptions = {}): Promise<T> {
    const attempts = options.idempotent ? this.maxRetries + 1 : 1;
    let lastError: HttpError | undefined;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await this.sleep(this.backoffMs * 2 ** (attempt - 1) * (0.5 + this.random()));
      try {
        return await this.once<T>(method, url, options.body);
      } catch (err) {
        if (!(err instanceof HttpError)) throw err;
        lastError = err;
        if (!isRetryable(err.status)) throw err;
      }
    }
    throw lastError!;
  }

  private async once<T>(method: string, url: string, body: unknown): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const token = await this.getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) throw new HttpError(res.status, `${method} ${url} failed with ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      const reason = controller.signal.aborted ? 'timed out' : 'network error';
      throw new HttpError(0, `${method} ${url} ${reason}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Network failure/timeout (0), rate limit and server errors. */
function isRetryable(status: number): boolean {
  return status === 0 || status === 429 || status >= 500;
}
