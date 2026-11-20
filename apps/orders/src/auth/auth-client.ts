import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';

/** Public, non-secret build config. The orders app is a public client (B11): there is no client secret. */
export interface AuthConfig {
  /** OpenID Connect issuer base URL (the Orchard Core backend). */
  authority: string;
  clientId: string;
  /** Where the authorization server sends the browser back; must be registered for the client. */
  redirectUri: string;
  scope: string;
}

export interface AuthEnv {
  VITE_BACKEND_URL?: string;
  VITE_OIDC_AUTHORITY?: string;
  VITE_OIDC_CLIENT_ID?: string;
}

/** Authority defaults to the backend URL; the redirect URI is the page origin root (what the backend registers). */
export function authConfigFromEnv(env: AuthEnv, origin: string = window.location.origin): AuthConfig {
  const authority = env.VITE_OIDC_AUTHORITY || env.VITE_BACKEND_URL;
  if (!authority) throw new Error('VITE_OIDC_AUTHORITY (or VITE_BACKEND_URL) is required when VITE_ORDERS_API=orchard');
  return {
    authority,
    clientId: env.VITE_OIDC_CLIENT_ID || 'bpb-orders-ui',
    redirectUri: `${origin}/`,
    scope: 'openid offline_access',
  };
}

/** The slice of oidc-client-ts' UserManager that this module uses (also the test seam). */
export interface OidcManager {
  getUser(): Promise<AuthUser | null>;
  signinRedirect(args?: { state?: unknown }): Promise<void>;
  signinRedirectCallback(url: string): Promise<AuthUser>;
  signinSilent(): Promise<AuthUser | null>;
  signoutRedirect(): Promise<void>;
  removeUser(): Promise<void>;
}

export type AuthUser = Pick<User, 'access_token' | 'refresh_token' | 'expired' | 'expires_in' | 'state'>;

/** Browser bits the client touches, injectable for tests. */
export interface AuthPage {
  href(): string;
  hash(): string;
  /** Replaces the URL without navigating. */
  replaceUrl(url: string): void;
  /** Tells hash routers (the shell) that the hash changed, which `replaceState` alone does not. */
  notifyHashChange(): void;
}

export const browserPage: AuthPage = {
  href: () => window.location.href,
  hash: () => window.location.hash,
  replaceUrl: (url) => window.history.replaceState(window.history.state, '', url),
  notifyHashChange: () => window.dispatchEvent(new HashChangeEvent('hashchange')),
};

/** Minimal Storage surface (sessionStorage in the browser). */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

const CALLBACK_PARAMS = ['code', 'state', 'iss', 'session_state', 'error', 'error_description', 'error_uri'];
const REAUTH_KEY = 'bpb.orders.reauth-at';
const REAUTH_WINDOW_MS = 60_000;
/** Renew a little before expiry so a request does not race the token's end. */
const MIN_REMAINING_S = 30;

/**
 * Authorization Code + PKCE for the orders app, on top of oidc-client-ts (no custom crypto or protocol code).
 * Everything else in the app only sees `getAccessToken()` and the `fetch` wrapper from `withReauth`.
 */
export class AuthClient {
  private callback?: Promise<void>;
  private redirect?: Promise<never>;
  private renewal?: Promise<AuthUser | null>;

  constructor(
    private readonly manager: OidcManager,
    private readonly page: AuthPage = browserPage,
    private readonly session: KeyValueStore = sessionStorage,
    private readonly now: () => number = Date.now,
  ) {}

  /** A valid access token. Handles the redirect callback once, renews with the refresh token, or redirects to login. */
  async getAccessToken(): Promise<string> {
    await this.handleCallbackOnce();
    const user = await this.manager.getUser();
    if (user && !isStale(user)) return user.access_token;
    if (user?.refresh_token) {
      const renewed = await this.renew().catch(() => null);
      if (renewed) return renewed.access_token;
    }
    return this.redirectToLogin();
  }

  /**
   * Called after an API answered 401. Re-authenticates at most once per minute: first by renewing with the
   * refresh token (returns the new token), otherwise by redirecting to login (never resolves).
   * Returns undefined when a re-authentication already happened recently, so a 401 cannot cause a loop.
   */
  async reauthenticate(): Promise<string | undefined> {
    const last = Number(this.session.getItem(REAUTH_KEY) ?? 0);
    if (this.now() - last < REAUTH_WINDOW_MS) return undefined;
    this.session.setItem(REAUTH_KEY, String(this.now()));
    const user = await this.manager.getUser();
    if (user?.refresh_token) {
      const renewed = await this.renew().catch(() => null);
      if (renewed) return renewed.access_token;
    }
    await this.manager.removeUser();
    return this.redirectToLogin();
  }

  async signOut(): Promise<void> {
    await this.manager.signoutRedirect();
  }

  private handleCallbackOnce(): Promise<void> {
    this.callback ??= this.handleCallback();
    return this.callback;
  }

  private async handleCallback(): Promise<void> {
    const url = new URL(this.page.href());
    if (!url.searchParams.has('state') || !(url.searchParams.has('code') || url.searchParams.has('error'))) return;
    const before = this.page.hash();
    const clean = (hash: string) => {
      const next = new URL(url.href);
      for (const p of CALLBACK_PARAMS) next.searchParams.delete(p);
      next.hash = hash;
      this.page.replaceUrl(next.href);
      if (hash !== before) this.page.notifyHashChange();
    };
    try {
      const user = await this.manager.signinRedirectCallback(url.href);
      // Restore the route the user was on before the login redirect (the shell routes on the hash).
      clean((user.state as { hash?: string } | undefined)?.hash || url.hash);
    } catch (err) {
      // Clean the URL even when the exchange fails, so a reload does not replay a used code.
      clean(before);
      throw err;
    }
  }

  /** One renewal at a time: refresh tokens rotate, so concurrent grants would invalidate each other. */
  private renew(): Promise<AuthUser | null> {
    this.renewal ??= this.manager.signinSilent().finally(() => (this.renewal = undefined));
    return this.renewal;
  }

  /** One redirect per page load, even when several requests ask at once. Never resolves: the page navigates away. */
  private redirectToLogin(): Promise<never> {
    this.redirect ??= this.manager.signinRedirect({ state: { hash: this.page.hash() } }).then(() => new Promise<never>(() => {}));
    return this.redirect;
  }
}

function isStale(user: AuthUser): boolean {
  return user.expired === true || (user.expires_in !== undefined && user.expires_in < MIN_REMAINING_S);
}

/**
 * `fetch` wrapper: on a 401 it re-authenticates once and repeats the request with the new token.
 * A 401 means the request was rejected before any processing, so repeating the update POST is safe (B14 still holds).
 */
export function withReauth(auth: Pick<AuthClient, 'reauthenticate'>, base: typeof fetch = (...a) => globalThis.fetch(...a)): typeof fetch {
  return async (input, init) => {
    const res = await base(input, init);
    if (res.status !== 401) return res;
    const token = await auth.reauthenticate();
    if (!token) return res;
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return base(input, { ...init, headers });
  };
}

const shared = new Map<string, AuthClient>();

/** One AuthClient per configuration for the whole page, so several <orders-app> instances share one session and one callback. */
export function getAuthClient(config: AuthConfig): AuthClient {
  const key = JSON.stringify(config);
  let client = shared.get(key);
  if (!client) {
    // Tokens and the PKCE state live in sessionStorage (per tab), never localStorage.
    const store = new WebStorageStateStore({ store: window.sessionStorage });
    const manager = new UserManager({
      authority: config.authority,
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      post_logout_redirect_uri: config.redirectUri,
      response_type: 'code',
      scope: config.scope,
      userStore: store,
      stateStore: store,
      automaticSilentRenew: false,
      loadUserInfo: false,
    });
    client = new AuthClient(manager);
    shared.set(key, client);
  }
  return client;
}
