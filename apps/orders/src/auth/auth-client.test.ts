import { describe, expect, it, vi } from 'vitest';
import {
  AuthClient,
  authConfigFromEnv,
  withReauth,
  type AuthPage,
  type AuthUser,
  type KeyValueStore,
  type OidcManager,
} from './auth-client';

const user = (over: Partial<AuthUser> = {}): AuthUser =>
  ({ access_token: 'at-1', refresh_token: 'rt-1', expired: false, expires_in: 3000, state: undefined, ...over }) as AuthUser;

function fakeManager(initial: AuthUser | null = null) {
  let stored = initial;
  const m = {
    getUser: vi.fn(async () => stored),
    signinRedirect: vi.fn(async () => {}),
    signinRedirectCallback: vi.fn(async () => (stored = user({ access_token: 'at-cb', state: { hash: '#/orders' } }))),
    signinSilent: vi.fn(async () => (stored = user({ access_token: 'at-renewed' }))),
    signoutRedirect: vi.fn(async () => {}),
    removeUser: vi.fn(async () => { stored = null; }),
  };
  return m satisfies OidcManager;
}

function fakePage(href: string) {
  let current = new URL(href);
  const page = {
    href: () => current.href,
    hash: () => current.hash,
    replaceUrl: vi.fn((u: string) => { current = new URL(u); }),
    notifyHashChange: vi.fn(),
  } satisfies AuthPage;
  return page;
}

function fakeSession(): KeyValueStore {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
}

const flushMicrotasks = () => new Promise((r) => setTimeout(r, 0));

describe('authConfigFromEnv', () => {
  it('uses the backend URL as authority, the public client id and the origin root as redirect URI', () => {
    expect(authConfigFromEnv({ VITE_BACKEND_URL: 'http://localhost:5080' }, 'http://localhost:5173')).toEqual({
      authority: 'http://localhost:5080',
      clientId: 'bpb-orders-ui',
      redirectUri: 'http://localhost:5173/',
      scope: 'openid offline_access',
    });
  });

  it('lets VITE_OIDC_AUTHORITY and VITE_OIDC_CLIENT_ID override', () => {
    const c = authConfigFromEnv({ VITE_BACKEND_URL: 'http://b', VITE_OIDC_AUTHORITY: 'http://idp', VITE_OIDC_CLIENT_ID: 'x' }, 'http://o');
    expect([c.authority, c.clientId]).toEqual(['http://idp', 'x']);
  });

  it('throws when there is no authority', () => {
    expect(() => authConfigFromEnv({}, 'http://o')).toThrow(/VITE_OIDC_AUTHORITY/);
  });

  it('has no secret field', () => {
    expect(Object.keys(authConfigFromEnv({ VITE_BACKEND_URL: 'http://b' }, 'http://o')).join()).not.toMatch(/secret/i);
  });
});

describe('AuthClient.getAccessToken', () => {
  it('redirects to the authorization endpoint when there is no session, remembering the route hash', async () => {
    const manager = fakeManager(null);
    const client = new AuthClient(manager, fakePage('http://localhost:5173/#/orders'), fakeSession());
    let settled = false;
    void client.getAccessToken().then(() => (settled = true), () => (settled = true));
    await flushMicrotasks();
    expect(manager.signinRedirect).toHaveBeenCalledTimes(1);
    expect(manager.signinRedirect).toHaveBeenCalledWith({ state: { hash: '#/orders' } });
    expect(settled).toBe(false); // the page is navigating away, nothing proceeds
  });

  it('redirects once even when several requests ask at the same time', async () => {
    const manager = fakeManager(null);
    const client = new AuthClient(manager, fakePage('http://localhost:5173/'), fakeSession());
    void client.getAccessToken(); void client.getAccessToken(); void client.getAccessToken();
    await flushMicrotasks();
    expect(manager.signinRedirect).toHaveBeenCalledTimes(1);
  });

  it('returns the access token of a valid session', async () => {
    const manager = fakeManager(user());
    const client = new AuthClient(manager, fakePage('http://localhost:5173/'), fakeSession());
    await expect(client.getAccessToken()).resolves.toBe('at-1');
    expect(manager.signinRedirect).not.toHaveBeenCalled();
    expect(manager.signinSilent).not.toHaveBeenCalled();
  });

  it('renews with the refresh token when the access token is expired or about to expire', async () => {
    for (const stale of [{ expired: true }, { expires_in: 5 }]) {
      const manager = fakeManager(user(stale));
      const client = new AuthClient(manager, fakePage('http://localhost:5173/'), fakeSession());
      await expect(client.getAccessToken()).resolves.toBe('at-renewed');
      expect(manager.signinSilent).toHaveBeenCalledTimes(1);
      expect(manager.signinRedirect).not.toHaveBeenCalled();
    }
  });

  it('shares one renewal between concurrent callers', async () => {
    const manager = fakeManager(user({ expired: true }));
    const client = new AuthClient(manager, fakePage('http://localhost:5173/'), fakeSession());
    await Promise.all([client.getAccessToken(), client.getAccessToken()]);
    expect(manager.signinSilent).toHaveBeenCalledTimes(1);
  });

  it('falls back to the login redirect when renewal fails', async () => {
    const manager = fakeManager(user({ expired: true }));
    manager.signinSilent.mockRejectedValue(new Error('invalid_grant'));
    const client = new AuthClient(manager, fakePage('http://localhost:5173/'), fakeSession());
    void client.getAccessToken();
    await flushMicrotasks();
    expect(manager.signinRedirect).toHaveBeenCalledTimes(1);
  });
});

describe('AuthClient redirect callback', () => {
  const callbackUrl = 'http://localhost:5173/?code=abc&state=xyz&iss=http%3A%2F%2Flocalhost%3A5080%2F';

  it('handles ?code&state exactly once, cleans the URL and restores the pre-login hash', async () => {
    const manager = fakeManager(null);
    const page = fakePage(callbackUrl);
    const client = new AuthClient(manager, page, fakeSession());
    await expect(Promise.all([client.getAccessToken(), client.getAccessToken()])).resolves.toEqual(['at-cb', 'at-cb']);
    expect(manager.signinRedirectCallback).toHaveBeenCalledTimes(1);
    expect(manager.signinRedirectCallback).toHaveBeenCalledWith(callbackUrl);
    expect(page.href()).toBe('http://localhost:5173/#/orders');
    expect(page.notifyHashChange).toHaveBeenCalledTimes(1);
    // a later call (another element instance) does not process it again
    await client.getAccessToken();
    expect(manager.signinRedirectCallback).toHaveBeenCalledTimes(1);
  });

  it('keeps unrelated query parameters', async () => {
    const page = fakePage('http://localhost:5173/?lang=en&code=abc&state=xyz');
    await new AuthClient(fakeManager(null), page, fakeSession()).getAccessToken();
    expect(page.href()).toBe('http://localhost:5173/?lang=en#/orders');
  });

  it('does not touch the URL or call the library when there is no callback', async () => {
    const manager = fakeManager(user());
    const page = fakePage('http://localhost:5173/#/orders?code=1');
    await new AuthClient(manager, page, fakeSession()).getAccessToken();
    expect(manager.signinRedirectCallback).not.toHaveBeenCalled();
    expect(page.replaceUrl).not.toHaveBeenCalled();
  });

  it('cleans the URL and rejects (no redirect loop) when the exchange fails', async () => {
    const manager = fakeManager(null);
    manager.signinRedirectCallback.mockRejectedValue(new Error('No matching state found in storage'));
    const page = fakePage(callbackUrl);
    const client = new AuthClient(manager, page, fakeSession());
    await expect(client.getAccessToken()).rejects.toThrow(/No matching state/);
    expect(page.href()).toBe('http://localhost:5173/');
    expect(manager.signinRedirect).not.toHaveBeenCalled();
  });
});

describe('401 handling', () => {
  const res = (status: number) => new Response(null, { status });

  it('renews and repeats the request once with the new token', async () => {
    const manager = fakeManager(user());
    const auth = new AuthClient(manager, fakePage('http://localhost:5173/'), fakeSession());
    const base = vi.fn<typeof fetch>().mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(200));
    const out = await withReauth(auth, base)('http://api/x', { method: 'POST', headers: { Authorization: 'Bearer old' }, body: '{}' });
    expect(out.status).toBe(200);
    expect(base).toHaveBeenCalledTimes(2);
    expect(new Headers(base.mock.calls[1]![1]!.headers).get('Authorization')).toBe('Bearer at-renewed');
    expect(base.mock.calls[1]![1]!.body).toBe('{}');
  });

  it('re-authenticates at most once: a second 401 within the window is returned, not looped', async () => {
    const manager = fakeManager(user());
    const auth = new AuthClient(manager, fakePage('http://localhost:5173/'), fakeSession());
    const base = vi.fn<typeof fetch>().mockImplementation(async () => res(401));
    const f = withReauth(auth, base);
    expect((await f('http://api/x')).status).toBe(401); // renewed, retried, still 401
    expect((await f('http://api/x')).status).toBe(401); // no further re-auth
    expect(manager.signinSilent).toHaveBeenCalledTimes(1);
    expect(manager.signinRedirect).not.toHaveBeenCalled();
    expect(base).toHaveBeenCalledTimes(3);
  });

  it('removes the session and redirects to login when there is no refresh token', async () => {
    const manager = fakeManager(user({ refresh_token: undefined }));
    const auth = new AuthClient(manager, fakePage('http://localhost:5173/#/orders'), fakeSession());
    const base = vi.fn<typeof fetch>().mockResolvedValue(res(401));
    void withReauth(auth, base)('http://api/x');
    await flushMicrotasks();
    expect(manager.removeUser).toHaveBeenCalledTimes(1);
    expect(manager.signinRedirect).toHaveBeenCalledTimes(1);
  });

  it('passes other statuses through untouched', async () => {
    const manager = fakeManager(user());
    const auth = new AuthClient(manager, fakePage('http://localhost:5173/'), fakeSession());
    const base = vi.fn<typeof fetch>().mockResolvedValue(res(403));
    expect((await withReauth(auth, base)('http://api/x')).status).toBe(403);
    expect(base).toHaveBeenCalledTimes(1);
    expect(manager.signinSilent).not.toHaveBeenCalled();
  });
});

describe('AuthClient.signOut', () => {
  it('delegates to the library', async () => {
    const manager = fakeManager(user());
    await new AuthClient(manager, fakePage('http://localhost:5173/'), fakeSession()).signOut();
    expect(manager.signoutRedirect).toHaveBeenCalledTimes(1);
  });
});
