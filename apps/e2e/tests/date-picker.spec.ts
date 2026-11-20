import { test, expect } from '@playwright/test';
import { dayKey, openAndSignIn } from '../support/auth';
import { deliveredBox } from '../support/orders';

test('picking yesterday shows that day (orders 1, 3, 5 delivered)', async ({ page }) => {
  await openAndSignIn(page, '/#/');
  const pick = page.getByRole('button', { name: 'Chọn ngày' });
  const header = page.locator('header');
  const todayText = await header.innerText();

  await expect(page.getByRole('dialog')).toHaveCount(0); // calendar not in the DOM until clicked
  await expect(pick).toHaveAttribute('aria-expanded', 'false');
  await pick.click();
  await expect(pick).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('dialog').locator(`[data-day="${dayKey(-1)}"] button`).click();

  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(header).not.toHaveText(todayText);
  for (const no of [1, 3, 5]) await expect(deliveredBox(page, no)).toBeChecked();
  for (const no of [2, 4, 6]) await expect(deliveredBox(page, no)).not.toBeChecked();
});
