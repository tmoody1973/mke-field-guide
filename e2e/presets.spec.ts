import { expect, test } from '@playwright/test';

for (const path of ['/events/tonight', '/events/this-weekend']) {
  test(`${path} renders the preset landing`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByText(/\d+ events?/).first()).toBeVisible(); // zero is a valid count — page must render, not error
    await expect(page.locator('h2, [class*="font-head"]').first()).toBeVisible();
  });
}
