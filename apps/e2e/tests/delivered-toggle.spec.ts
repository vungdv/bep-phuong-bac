import { test, expect } from '@playwright/test';
import { openAndSignIn } from '../support/auth';
import { deliveredBox } from '../support/orders';

test('Delivered survives reload and is seen from a second, freshly signed-in browser', async ({ page, browser }) => {
  await openAndSignIn(page, '/#/');
  const box = deliveredBox(page, 2);
  try {
    // A box left checked by a crashed earlier run is restored first (and cleaned up in finally), then asserted.
    if (await box.isChecked()) {
      await box.click();
      await expect(box).not.toBeChecked();
      await expect(box).toBeEnabled();
    }
    await expect(box).not.toBeChecked();
    await box.click();
    await expect(box).toBeChecked();
    await expect(box).toBeEnabled(); // mutation settled

    await page.reload();
    await expect(deliveredBox(page, 2)).toBeChecked();

    // "Another device": a brand-new context has no session, so it signs in again.
    const other = await browser.newContext({ timezoneId: 'Asia/Ho_Chi_Minh', locale: 'vi-VN' });
    try {
      const page2 = await other.newPage();
      await openAndSignIn(page2, '/#/');
      await expect(deliveredBox(page2, 2)).toBeChecked();
    } finally {
      await other.close();
    }

    await deliveredBox(page, 2).click();
    await expect(deliveredBox(page, 2)).not.toBeChecked();
    await expect(deliveredBox(page, 2)).toBeEnabled();
    await page.reload();
    await expect(deliveredBox(page, 2)).not.toBeChecked();
  } finally {
    // Restore state even on failure.
    const b = deliveredBox(page, 2);
    if (await b.isVisible().catch(() => false)) {
      if (await b.isChecked()) {
        await b.click();
        await expect(b).not.toBeChecked();
        await expect(b).toBeEnabled();
      }
    }
  }
});
