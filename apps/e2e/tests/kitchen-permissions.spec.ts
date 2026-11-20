import { test, expect } from '@playwright/test';
import { BACKEND_URL, openAndSignIn } from '../support/auth';

test('the kitchen account cannot delete an order (403)', async ({ page, request }) => {
  await openAndSignIn(page, '/#/');
  // Negative check only: read the app's own session token from sessionStorage.
  const token = await page.evaluate(() => {
    for (let i = 0; i < sessionStorage.length; i++) {
      const k = sessionStorage.key(i)!;
      if (k.startsWith('oidc.user:')) return JSON.parse(sessionStorage.getItem(k)!).access_token as string;
    }
    return null;
  });
  expect(token).toBeTruthy();
  const headers = { Authorization: `Bearer ${token}` };
  const gql = await request.post(`${BACKEND_URL}/api/graphql`, {
    headers,
    data: { query: '{ order(first:1) { contentItemId } }' },
  });
  expect(gql.status()).toBe(200);
  const id = (await gql.json()).data.order[0].contentItemId as string;
  const del = await request.delete(`${BACKEND_URL}/api/content/${id}`, { headers });
  expect(del.status()).toBe(403);
});
