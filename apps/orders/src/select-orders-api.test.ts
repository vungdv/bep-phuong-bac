import { describe, expect, it } from 'vitest';
import { OrchardOrdersApi } from './api/orchard-orders-api';
import { selectOrdersApi } from './app';
import { getAuthClient } from './auth/auth-client';

describe('selectOrdersApi', () => {
  it('builds an OrchardOrdersApi from a backend URL', () => {
    expect(selectOrdersApi({ VITE_BACKEND_URL: 'http://localhost:5080' })).toBeInstanceOf(OrchardOrdersApi);
  });

  it('throws naming VITE_BACKEND_URL when it is missing', () => {
    expect(() => selectOrdersApi({ VITE_BACKEND_URL: '' })).toThrow(/VITE_BACKEND_URL/);
  });

  it('shares one auth client per configuration (several <orders-app> instances, one callback)', () => {
    const cfg = { authority: 'http://localhost:5080', clientId: 'bpb-orders-ui', redirectUri: 'http://localhost:3000/', scope: 'openid offline_access' };
    expect(getAuthClient(cfg)).toBe(getAuthClient({ ...cfg }));
  });
});
