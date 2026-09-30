import { expect, test } from '@playwright/test';

test('client loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).toContainText('tick rate 20');
});
