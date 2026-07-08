import { expect, test } from '@playwright/test';

test('facet chips filter via the URL', async ({ page }) => {
  await page.goto('/events');
  await page.getByRole('link', { name: 'Free only' }).click();
  await expect(page).toHaveURL(/free=1/);
  await page.getByRole('link', { name: 'Music', exact: true }).click();
  await expect(page).toHaveURL(/cat=music/);
  await expect(page).toHaveURL(/free=1/); // chips preserve each other
  await page.getByRole('link', { name: 'Clear all' }).click();
  await expect(page).toHaveURL(/\/events$/);
});
