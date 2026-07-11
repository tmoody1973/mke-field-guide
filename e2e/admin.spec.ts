import { expect, test } from '@playwright/test';

const hasClerkKeys =
  !!process.env.CLERK_SECRET_KEY && !!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

test.describe('admin auth gate', () => {
  test.skip(!hasClerkKeys, 'Clerk keys not configured in this environment');

  test('unauthenticated /admin/picks redirects to the admin sign-in', async ({ page }) => {
    await page.goto('/admin/picks');
    await expect(page).toHaveURL(/\/admin\/sign-in/);
  });

  test('unauthenticated /admin redirects to the admin sign-in', async ({ page }) => {
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/sign-in/);
  });

  test('unauthenticated /admin/review redirects to the admin sign-in', async ({ page }) => {
    await page.goto('/admin/review');
    await expect(page).toHaveURL(/\/admin\/sign-in/);
  });

  test('unauthenticated /admin/sources redirects to the admin sign-in', async ({ page }) => {
    await page.goto('/admin/sources');
    await expect(page).toHaveURL(/\/admin\/sign-in/);
  });

  test('unauthenticated /admin/events redirects to the admin sign-in', async ({ page }) => {
    await page.goto('/admin/events');
    await expect(page).toHaveURL(/\/admin\/sign-in/);
  });

  test('unauthenticated /admin/venues redirects to the admin sign-in', async ({ page }) => {
    await page.goto('/admin/venues');
    await expect(page).toHaveURL(/\/admin\/sign-in/);
  });
});
