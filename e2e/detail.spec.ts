import { expect, test } from '@playwright/test';

test('event detail carries calendar links and JSON-LD', async ({ page }) => {
  await page.goto('/events');
  await page.locator('main a[href^="/events/"]:not([href*="tonight"]):not([href*="today"]):not([href*="this-weekend"])').first().click();
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Google Calendar' })).toHaveAttribute('href', /calendar\.google\.com/);
  await expect(page.getByRole('link', { name: /Download \.ics/i })).toHaveAttribute('href', /\/ics$/);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(1);
});

test('the ics endpoint serves a calendar file', async ({ page, request }) => {
  await page.goto('/events');
  const href = await page.locator('main a[href^="/events/"]:not([href*="tonight"]):not([href*="today"]):not([href*="this-weekend"])').first().getAttribute('href');
  const response = await request.get(`${href}/ics`);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/calendar');
  expect(await response.text()).toContain('BEGIN:VEVENT');
});
