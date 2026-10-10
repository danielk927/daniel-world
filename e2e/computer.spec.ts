import { expect, test } from '@playwright/test';
import { enterWorld, expectWorld, turnTo, waitUntilStill, walkUntil, world } from './helpers.ts';

test('the kitchen computer runs DOOM, and pauses when the cook steps away', async ({ browser }) => {
  const page = await enterWorld(browser, { name: 'Gamer', online: false });
  await waitUntilStill(page);
  // Along the aisle by the dining room doors to the chef's desk in the south-west corner.
  await walkUntil(page, 'KeyA', (p) => p.x < -6.2);
  await waitUntilStill(page);
  await turnTo(page, Math.PI / 2, -0.3);

  // Without pointer lock the game picks under the cursor: find the screen around the middle.
  const prompt = page.locator('.prompt-sentence');
  let found = false;
  for (let y = 200; y < 400 && !found; y += 8) {
    await page.mouse.move(480, y);
    found = (await prompt.textContent()) === 'Press E to play DOOM';
  }
  expect(found, 'the cursor should find the computer').toBe(true);

  await page.keyboard.press('KeyE');
  const running = await expectWorld(
    page,
    (w) => w.mode === 'computer' && w.computer.state === 'running' && w.computer.frames > 30,
    'DOOM boots and draws frames',
    60_000,
  );
  // The controls are laid out over the screen until the first key, which still reaches DOOM.
  const guide = page.getByRole('region', { name: 'DOOM' });
  await expect(guide).toBeVisible();
  await expect(guide).toContainText('Open doors and flip switches');
  await expect(page.locator('.computer-hint')).toBeHidden();

  // At the computer the keys play DOOM: the cook stays where they are.
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(500);
  await page.keyboard.up('KeyW');
  expect((await world(page)).player).toEqual(running.player);
  await expect(guide).toBeHidden();
  await expect(page.locator('.computer-hint')).toBeVisible();

  // Esc steps away; the game pauses where it is, and the keys walk the kitchen again.
  await page.keyboard.press('Escape');
  await expectWorld(
    page,
    (w) => w.mode === 'playing' && w.computer.state === 'paused',
    'stepped away, DOOM paused',
  );
  await expect(page.locator('.computer-hint')).toBeHidden();

  // Holding E to sit down again: its auto-repeat is the same press, so it does not reach DOOM, and
  // the controls stay up.
  await expect(prompt).toHaveText('Press E to play DOOM');
  await page.keyboard.down('KeyE');
  await expectWorld(
    page,
    (w) => w.mode === 'computer' && w.computer.state === 'running',
    'seated again, DOOM running',
  );
  await page.keyboard.down('KeyE');
  await page.keyboard.down('KeyE');
  await page.waitForTimeout(200);
  await expect(guide).toBeVisible();
  expect((await world(page)).computer.keys).toBe(0);
  await page.keyboard.up('KeyE');
  await page.keyboard.press('Escape');
  await expectWorld(page, (w) => w.mode === 'playing', 'stepped away again');

  // Away to another window with a key held, so its release never comes: DOOM lets go of it, and the
  // cook steps away, as when the browser takes back the mouse.
  await expect(prompt).toHaveText('Press E to play DOOM');
  await page.keyboard.press('KeyE');
  await expectWorld(page, (w) => w.computer.state === 'running', 'seated, DOOM running');
  await page.keyboard.down('ArrowUp');
  await expectWorld(page, (w) => w.computer.keys === 1, 'the marine walks');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expectWorld(
    page,
    (w) => w.mode === 'playing' && w.computer.state === 'paused' && w.computer.keys === 0,
    'stepped away, nothing held',
  );
  await page.keyboard.up('ArrowUp');

  // Facing the desk (west), backing away walks east.
  await walkUntil(page, 'KeyS', (p) => p.x > -5.5);
  await page.context().close();
});
