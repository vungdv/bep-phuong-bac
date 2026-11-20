import { expect, type Page } from '@playwright/test';

/** Dev defaults match backend/.env.example; override with E2E_KITCHEN_USERNAME / E2E_KITCHEN_PASSWORD. */
export const KITCHEN_USERNAME = process.env.E2E_KITCHEN_USERNAME ?? 'kitchen';
export const KITCHEN_PASSWORD = process.env.E2E_KITCHEN_PASSWORD ?? 'Kitchen123!dev';
export const BACKEND_URL = process.env.E2E_BACKEND_URL ?? 'http://localhost:5080';

/** Fills the real Orchard Core login form (no token injection). */
export async function signInOnOrchard(page: Page): Promise<void> {
  await page.waitForURL(/\/Login/);
  await page.locator('[name="LoginForm.UserName"]').fill(KITCHEN_USERNAME);
  await page.locator('[name="LoginForm.Password"]').fill(KITCHEN_PASSWORD);
  await page.locator('form').filter({ has: page.locator('[name="LoginForm.Password"]') })
    .locator('button[type="submit"], input[type="submit"]').first().click();
}

/** Opens `url`, signs in through the redirect, and waits for the order table. */
export async function openAndSignIn(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await signInOnOrchard(page);
  await expect(page.getByRole('table')).toBeVisible();
}

/** Today in the kitchen's zone as YYYY-MM-DD. */
export function dayKey(offset = 0): string {
  const d = new Date(Date.now() + offset * 86_400_000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(d);
}
