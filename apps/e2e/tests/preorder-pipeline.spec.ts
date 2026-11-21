import { test, expect } from '@playwright/test';
import { BACKEND_URL, dayKey, openAndSignIn } from '../support/auth';

// Spec 2026-11-20-process-preorder, E2E row: a message created through the content API appears as an order in the orders
// app list for its service day. Needs the LLM to be the deterministic stub: `make stub-up` (or `make test-backend`'s setup).
const SCRIPT_SECRET = process.env.E2E_SCRIPT_CLIENT_SECRET ?? 'dev-script-secret';
const NAME = `E2E Pipeline ${Date.now()}`;

async function token(): Promise<string> {
  const res = await fetch(`${BACKEND_URL}/connect/token`, {
    method: 'POST',
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: 'bpb-orders-script', client_secret: SCRIPT_SECRET }),
  });
  if (!res.ok) throw new Error(`script client token failed: HTTP ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

test('a message created through the content API shows as an order for its service day', async ({ page }) => {
  const tomorrow = dayKey(1);
  const auth = { Authorization: `Bearer ${await token()}`, 'Content-Type': 'application/json' };
  const text = `[stub:tool=record_order args={"qty":37,"serviceDate":"${tomorrow}"}]`;
  let messageId = '';
  let orderId = '';
  try {
    // The workflow runs inline: the response comes back after the (stub) LLM answered and the order was created.
    const res = await fetch(`${BACKEND_URL}/api/content`, {
      method: 'POST',
      headers: auth,
      signal: AbortSignal.timeout(130_000),
      body: JSON.stringify({
        ContentType: 'ChannelMessage', DisplayText: 'e2e pipeline', Published: true,
        ChannelMessage: { SenderName: { Text: NAME }, Text: { Text: text } },
      }),
    });
    expect(res.status, 'create message failed: the LLM must be the stub, run `make stub-up` right before this test').toBe(200);
    messageId = ((await res.json()) as { ContentItemId: string }).ContentItemId;

    const gql = await fetch(`${BACKEND_URL}/api/graphql`, {
      method: 'POST',
      headers: auth,
      body: JSON.stringify({ query: `{ order(where:{sourceContentItemId:"${messageId}"}) { contentItemId } }` }),
    });
    const orders = ((await gql.json()) as { data: { order: { contentItemId: string }[] } }).data.order;
    expect(orders, 'one order for the message: the LLM must be the stub, run `make stub-up` right before this test').toHaveLength(1);
    orderId = orders[0].contentItemId;

    await openAndSignIn(page, '/#/');
    await page.getByRole('button', { name: 'Chọn ngày' }).click();
    await page.getByRole('dialog').locator(`[data-day="${tomorrow}"] button`).click();
    const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: NAME, exact: true }) });
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('cell', { name: '37', exact: true })).toBeVisible();
  } finally {
    for (const id of [orderId, messageId].filter(Boolean)) {
      const del = await fetch(`${BACKEND_URL}/api/content/${id}`, { method: 'DELETE', headers: auth });
      if (!del.ok) throw new Error(`cleanup failed: DELETE ${id} returned HTTP ${del.status}; delete it by hand`);
    }
  }
});
