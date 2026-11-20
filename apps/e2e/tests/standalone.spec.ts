import { test, expect } from '@playwright/test';
import { openAndSignIn } from '../support/auth';
import { expectSixOrders } from '../support/orders';

test('standalone orders page signs in and lists today', async ({ page }) => {
  await openAndSignIn(page, 'http://localhost:5174/');
  await expect(page).toHaveURL(/^http:\/\/localhost:5174\//);
  await expectSixOrders(page);
});
