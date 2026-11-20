import { test, expect } from '@playwright/test';
import { openAndSignIn, signInOnOrchard } from '../support/auth';
import { expectSixOrders } from '../support/orders';

test.describe('shell (vi)', () => {
  test('redirects to Orchard login, returns to the shell route and shows the seeded orders', async ({ page }) => {
    await page.goto('/#/');
    await expect(page).toHaveURL(/localhost:5080\/Login/);
    await signInOnOrchard(page);
    await expect(page.getByRole('table')).toBeVisible();

    await expect(page).toHaveURL(/^http:\/\/localhost:5173\/#\//);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    for (const name of ['STT', 'Tên', 'Đã giao']) {
      await expect(page.getByRole('columnheader', { name: new RegExp(name) })).toBeVisible();
    }
    await expect(page.getByRole('columnheader')).toHaveCount(6);
    await expectSixOrders(page);
    // Names come from the backend seed (backend/scripts/seed.sh)
    await expect(page.getByRole('cell', { name: 'Nguyễn Văn An', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Đặng Ngọc Lan', exact: true })).toBeVisible();
    // Not the localStorage mock
    expect(await page.evaluate(() => localStorage.getItem('bpb.orders'))).toBeNull();
  });
});

test.describe('shell (en)', () => {
  test.use({ locale: 'en-US' });
  test('shows English labels', async ({ page }) => {
    await openAndSignIn(page, '/#/');
    await expect(page.getByRole('button', { name: 'Pick date' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Name' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Delivered' })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /^Delivered order 1 - / })).toBeVisible();
    await expectSixOrders(page);
  });
});
