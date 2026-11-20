import { describe, expect, it } from 'vitest';
import { LocalStorageOrdersApi } from './api/local-storage-orders-api';
import { OrchardOrdersApi } from './api/orchard-orders-api';
import { selectOrdersApi } from './app';
import { getAuthClient } from './auth/auth-client';

describe('selectOrdersApi', () => {
  it('defaults to LocalStorageOrdersApi', () => {
    expect(selectOrdersApi({})).toBeInstanceOf(LocalStorageOrdersApi);
  });

  it('uses OrchardOrdersApi for orchard plus a backend URL', () => {
    expect(selectOrdersApi({ VITE_ORDERS_API: 'orchard', VITE_BACKEND_URL: 'http://localhost:5080' })).toBeInstanceOf(OrchardOrdersApi);
  });

  it('throws naming VITE_BACKEND_URL when orchard has no URL', () => {
    expect(() => selectOrdersApi({ VITE_ORDERS_API: 'orchard', VITE_BACKEND_URL: '' })).toThrow(/VITE_BACKEND_URL/);
  });

  it('localStorage mode needs no auth: no auth client is created and nothing is stored in sessionStorage', () => {
    sessionStorage.clear();
    expect(selectOrdersApi({ VITE_OIDC_AUTHORITY: 'http://localhost:5080' })).toBeInstanceOf(LocalStorageOrdersApi);
    expect(sessionStorage.length).toBe(0);
  });

  it('orchard mode shares one auth client per configuration (several <orders-app> instances, one callback)', () => {
    const cfg = { authority: 'http://localhost:5080', clientId: 'bpb-orders-ui', redirectUri: 'http://localhost:3000/', scope: 'openid offline_access' };
    expect(getAuthClient(cfg)).toBe(getAuthClient({ ...cfg }));
  });
});
