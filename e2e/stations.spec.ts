import { expect, test } from '@playwright/test';
import { PASS_DISHES } from '@world/shared';
import {
  enterWorld,
  face,
  faceStation,
  MAP_VIEWPORT,
  waitUntilStill,
  walkUntil,
  world,
} from './helpers.ts';

test('Education opens at the pastry table across from Skills, and the map and the room give way to it', async ({
  browser,
}) => {
  const page = await enterWorld(browser, {
    name: 'Pastry Cook',
    online: false,
    viewport: MAP_VIEWPORT,
  });
  // From the spawn, round the west end of the pass and the piano, then up to the pastry island.
  await walkUntil(page, 'KeyA', (p) => p.x < -5.3);
  await walkUntil(page, 'KeyW', (p) => p.z < -2.6);
  await walkUntil(page, 'KeyD', (p) => p.x > -3.2);
  await waitUntilStill(page);
  await faceStation(page, 'patisserie');
  // Without pointer lock the game picks under the cursor: the middle of the screen, as the
  // crosshair would.
  await page.mouse.move(MAP_VIEWPORT.width / 2, MAP_VIEWPORT.height / 2);
  await expect(page.locator('.prompt-sentence')).toHaveText('Press E to open Education');
  await expect(page.locator('.minimap')).toBeVisible();
  await page.keyboard.press('KeyE');
  await expect(page.getByRole('dialog', { name: 'Education' })).toBeVisible();
  // The panel's dark side would wash out a long room name, so the map and the room give way to it.
  await expect(page.locator('.minimap')).toBeHidden();
  await expect(page.locator('.hud-room-title')).toBeHidden();
  await page.context().close();
});

test('the croissant by the east wall opens while the walk-in is shut', async ({ browser }) => {
  const page = await enterWorld(browser, { name: 'Diner', online: false });
  expect((await world(page)).cooler.open).toBe(false);
  await waitUntilStill(page);
  // From the spawn the croissant is at the east end of the pass, and the ten meter pick ray past it
  // meets the east wall: picking stops at the wall rather than refusing the aim.
  await face(
    page,
    PASS_DISHES.find((d) => d.id === 'truffle-croissant')!,
  );
  await page.mouse.move(480, 270);
  await expect(page.locator('.prompt-sentence')).toHaveText(
    'Press E to open Black Truffle Croissant',
  );
  await page.keyboard.press('KeyE');
  await expect(page.getByRole('dialog', { name: 'Black Truffle Croissant' })).toBeVisible();
  await page.context().close();
});
