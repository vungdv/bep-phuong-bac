import { expect, type Locator, type Page } from '@playwright/test';

/** The delivered checkbox of order `no` (aria-label "Đã giao đơn N - Name" / "Delivered order N - Name"). */
export function deliveredBox(page: Page, no: number): Locator {
  return page.getByRole('checkbox', { name: new RegExp(`(?:Đã giao đơn|Delivered order) ${no} - `) });
}

export async function expectSixOrders(page: Page): Promise<void> {
  await expect(page.getByRole('checkbox')).toHaveCount(6);
  const rows = page.getByRole('row');
  // header row + 6 orders
  await expect(rows).toHaveCount(7);
  for (let no = 1; no <= 6; no++) {
    await expect(rows.nth(no).getByRole('cell').first()).toHaveText(String(no));
  }
}
