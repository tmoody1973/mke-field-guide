import { expect, test } from '@playwright/test';

test('search returns day-grouped results', async ({ page }) => {
  await page.goto('/events');
  await page.getByLabel('Search Milwaukee events').fill('music this weekend');
  await page.getByRole('button', { name: /GO/ }).click();
  await expect(page).toHaveURL(/q=music\+this\+weekend/);
  await expect(page.locator('main a[href^="/events/"]').first()).toBeVisible();
  await expect(page.getByText(/\d+ events?/).first()).toBeVisible();
});
