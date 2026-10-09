import { expect, test } from '@playwright/test';
import { enterWorld, expectWorld, waitUntilStill } from './helpers.ts';

test('each dish on the pass opens its own panel, with its photo', async ({ browser }) => {
  const page = await enterWorld(browser, { name: 'Diner', online: false });
  await waitUntilStill(page);
  // The roti sits on the pass straight ahead of the spawn, below eye level. Without pointer lock the
  // game picks under the cursor, so lower it from the middle of the screen until it finds the plate.
  const prompt = page.locator('.prompt-sentence');
  let y = 270;
  for (; y < 540; y += 6) {
    await page.mouse.move(480, y);
    if ((await prompt.textContent()) === 'Press E to open Roti and dips') break;
  }
  expect(y, 'the cursor should find the roti').toBeLessThan(540);

  // A click throws a knife, even at a station; E is what opens it.
  const dialog = page.getByRole('dialog', { name: 'Roti and dips' });
  await page.mouse.click(480, y);
  await expectWorld(page, (w) => w.knives.flying + w.knives.stuck === 1, 'the click throws');
  await expect(dialog).toBeHidden();
  await page.keyboard.press('KeyE');
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Kabawa, New York');
  const photo = dialog.getByRole('img', { name: /roti/i });
  await expect(photo).toBeVisible();
  await expect
    .poll(() => photo.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expectWorld(page, (w) => w.mode === 'playing', 'back to playing');
  await page.context().close();
});
