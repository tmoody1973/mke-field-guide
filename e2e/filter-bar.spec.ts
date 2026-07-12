import { expect, test } from '@playwright/test';

test('view toggle switches grid/list and keeps event links intact', async ({ page }) => {
  await page.goto('/events');
  await page.getByRole('link', { name: 'List', exact: true }).click();
  await expect(page).toHaveURL(/view=list/);
  await expect(page.locator('main a[href^="/events/"]').first()).toBeVisible();
  await page.getByRole('link', { name: 'Grid', exact: true }).click();
  await expect(page).not.toHaveURL(/view=list/);
});

test('recommended sort updates the URL and results still render', async ({ page }) => {
  await page.goto('/events');
  await page.getByRole('link', { name: 'Recommended', exact: true }).click();
  await expect(page).toHaveURL(/sort=recommended/);
  await expect(page.getByText(/\d+ events?/).first()).toBeVisible();
});

test('show map toggles the map panel or its empty-pins note', async ({ page }) => {
  await page.goto('/events');
  await page.getByRole('link', { name: /Show Map/ }).click();
  await expect(page).toHaveURL(/map=1/);
  const mapPanel = page.getByTestId('map-panel');
  const emptyNote = page.getByText('No mappable venues in this result set yet.');
  await expect(mapPanel.or(emptyNote)).toBeVisible();
});

test('view toggle preserves an active free=1 chip', async ({ page }) => {
  await page.goto('/events?free=1');
  await page.getByRole('link', { name: 'List', exact: true }).click();
  await expect(page).toHaveURL(/view=list/);
  await expect(page).toHaveURL(/free=1/);
});

test('near me updates the URL with sort and coordinates when geolocation is granted', async ({ page, context }) => {
  await context.grantPermissions(['geolocation']);
  await context.setGeolocation({ latitude: 43.0389, longitude: -87.9065 });
  await page.goto('/events');
  await page.getByRole('button', { name: /Near Me/ }).click();
  await expect(page).toHaveURL(/sort=near/);
  await expect(page).toHaveURL(/lat=/);
  await expect(page).toHaveURL(/lng=/);
});

test.describe('390px viewport', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('no horizontal overflow with the filter bar in list view', async ({ page }) => {
    await page.goto('/events?view=list');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
