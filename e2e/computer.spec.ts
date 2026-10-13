import { expect, test } from '@playwright/test';
import {
  column,
  enterWorld,
  expectWorld,
  findWithCursor,
  MAP_VIEWPORT,
  turnTo,
  waitForFrames,
  waitUntilStill,
  walkUntil,
  world,
} from './helpers.ts';

test('the kitchen computer runs DOOM, and pauses when the cook steps away', async ({ browser }) => {
  const page = await enterWorld(browser, { name: 'Gamer', online: false, viewport: MAP_VIEWPORT });
  await waitUntilStill(page);
  // Along the aisle by the dining room doors to the chef's desk in the south-west corner.
  await walkUntil(page, 'KeyA', (p) => p.x < -6.2);
  await waitUntilStill(page);
  await turnTo(page, Math.PI / 2, -0.3);

  // Without pointer lock the game picks under the cursor: find the screen around the middle.
  const prompt = page.locator('.prompt-sentence');
  const found = await findWithCursor(page, column(480, 200, 400, 8), 'Press E to play DOOM');
  expect(found, 'the cursor should find the computer').not.toBeNull();

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

  // At the computer the keys play DOOM: the cook stays where they are, however long the game runs
  // with the key down (half a second of its clock: a frame is at least a display refresh).
  await page.keyboard.down('KeyW');
  await waitForFrames(page, 30);
  await page.keyboard.up('KeyW');
  expect((await world(page)).player).toEqual(running.player);
  await expect(guide).toBeHidden();
  await expect(page.locator('.computer-hint')).toBeVisible();
  // Seated at the desk there is nowhere to go: the map gives way, and the room keeps its corner.
  await expect(page.locator('.minimap')).toBeHidden();
  const edges = () =>
    page.evaluate(() => {
      const room = document.querySelector('.hud-room-title')!.getBoundingClientRect();
      const map = document.querySelector('.minimap')!.getBoundingClientRect();
      return {
        room: room.left,
        roomBottom: room.bottom,
        chat: document.querySelector('.chat')!.getBoundingClientRect().left,
        map: map.left,
        mapTop: map.top,
      };
    });
  const seated = await edges();
  expect(seated.room, "the room keeps the corner, on the chat's edge").toBeCloseTo(seated.chat, 0);
  // A notice from the computer (one says to step away) is for the desk: it does not follow the cook.
  await page.evaluate(() => {
    const notice = document.createElement('div');
    notice.className = 'toast';
    notice.textContent =
      'The kitchen computer crashed. Step away and sit down again to restart it.';
    document.querySelector('.toasts')!.append(notice);
  });
  await expect(page.locator('.toasts .toast')).toHaveCount(1);

  // Esc steps away; the game pauses where it is, and the keys walk the kitchen again.
  await page.keyboard.press('Escape');
  await expectWorld(
    page,
    (w) => w.mode === 'playing' && w.computer.state === 'paused',
    'stepped away, DOOM paused',
  );
  await expect(page.locator('.computer-hint')).toBeHidden();
  await expect(page.locator('.minimap')).toBeVisible();
  await expect(page.locator('.toasts .toast')).toHaveCount(0);
  const away = await edges();
  expect(away.map, "the map is back on the room's edge").toBeCloseTo(away.room, 0);
  expect(away.mapTop, 'the map is back under the room').toBeGreaterThan(away.roomBottom);

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
  await waitForFrames(page, 10);
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
