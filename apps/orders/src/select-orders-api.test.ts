import { describe, expect, it } from 'vitest';
import { LocalStorageOrdersApi } from './api/local-storage-orders-api';
import { OrchardOrdersApi } from './api/orchard-orders-api';
import { selectOrdersApi } from './app';

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
});
