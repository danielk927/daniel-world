import { expect, test } from '@playwright/test';
import { enterWorld, turnTo, waitUntilStill, walkUntil, world } from './helpers.ts';

test('the plonge by the east wall opens while the walk-in is shut', async ({ browser }) => {
  const page = await enterWorld(browser, { name: 'Dishwasher', online: false });
  expect((await world(page)).cooler.open).toBe(false);
  // From the spawn, along the aisle toward the dish pit in the south-east corner, then face east,
  // where the walk-in's wall is behind it.
  await walkUntil(page, 'KeyD', (p) => p.x > 2.6);
  await waitUntilStill(page);
  await turnTo(page, -Math.PI / 2, -0.3);

  // Without pointer lock the game picks under the cursor: sweep it over the view until it finds
  // the station.
  const prompt = page.locator('.prompt-sentence');
  let found = false;
  for (let y = 120; y < 440 && !found; y += 16) {
    for (let x = 240; x < 900 && !found; x += 30) {
      await page.mouse.move(x, y);
      found = (await prompt.textContent()) === 'Press E to open Education and contact';
    }
  }
  expect(found, 'the cursor should find the plonge in front of the wall').toBe(true);
  await page.keyboard.press('KeyE');
  await expect(page.getByRole('dialog', { name: 'Education and contact' })).toBeVisible();
  await page.context().close();
});
