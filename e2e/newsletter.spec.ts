import { neon } from '@neondatabase/serverless';
import { expect, test } from '@playwright/test';

test('newsletter capture stores and thanks', async ({ page }) => {
  const email = `e2e-${Date.now()}@example.com`;
  await page.goto('/');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'JOIN' }).click();
  await expect(page.getByText(/You're in/)).toBeVisible();

  const sql = neon(process.env.DATABASE_URL!);
  const rows = await sql`SELECT id FROM newsletter_subscribers WHERE email = ${email}`;
  expect(rows).toHaveLength(1);
  await sql`DELETE FROM newsletter_subscribers WHERE email = ${email}`; // leave prod clean
});
