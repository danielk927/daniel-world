import { expect, test } from '@playwright/test';

test('landing screen loads over the 3D world', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Daniel Kim' })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole('button', { name: 'Enter world' })).toBeEnabled();
  await expect(page.getByLabel('Your name')).not.toHaveValue('');
});

test('portfolio page renders every section', async ({ page }) => {
  await page.goto('/portfolio.html');
  await expect(page.getByRole('heading', { level: 2 })).toHaveCount(8);
});
