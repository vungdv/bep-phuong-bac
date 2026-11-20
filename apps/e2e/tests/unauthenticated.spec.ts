import { test, expect } from '@playwright/test';
import { BACKEND_URL } from '../support/auth';

test('GraphQL without a token is 401 and returns no order data', async ({ request }) => {
  const res = await request.post(`${BACKEND_URL}/api/graphql`, {
    data: { query: '{ order { contentItemId no customerName } }' },
  });
  expect(res.status()).toBe(401);
  expect(await res.text()).not.toContain('customerName');
});
