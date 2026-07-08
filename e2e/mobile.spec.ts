import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 390, height: 844 } });

for (const path of ['/', '/events', '/picks']) {
  test(`no horizontal overflow at 390px: ${path}`, async ({ page }) => {
    await page.goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
  });
}

test('all four station tabs visible without scrolling at 390px', async ({ page }) => {
  await page.goto('/');
  for (const name of ['88Nine', 'HYFIN', 'Rhythm Lab', '414 Music']) {
    await expect(page.getByRole('button', { name })).toBeInViewport();
  }
});
