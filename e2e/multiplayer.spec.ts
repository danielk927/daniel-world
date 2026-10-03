import { expect, test } from '@playwright/test';
import type { WorldServer } from '../apps/server/src/server.ts';
import {
  enterWorld,
  expectWorld,
  startRoomServer,
  waitUntilStill,
  walkUntil,
  world,
} from './helpers.ts';

let server: WorldServer;

test.beforeAll(async () => {
  server = await startRoomServer();
});

test.afterAll(async () => {
  await server.close();
});

test('two players join the lobby and see each other', async ({ browser }) => {
  const a = await enterWorld(browser, { name: 'Alice' });
  const b = await enterWorld(browser, { name: 'Bob' });

  for (const page of [a, b]) {
    const state = await expectWorld(page, (w) => w.playerCount === 2, 'both should see 2 players');
    expect(state.room).toBe('lobby');
  }
  expect((await world(a)).remotePlayers.map((p) => p.name)).toEqual(['Bob']);
  expect((await world(b)).remotePlayers.map((p) => p.name)).toEqual(['Alice']);
  await expect(b.getByRole('region', { name: 'Players in this room' })).toContainText('2 / 16');
  await expect(a.getByRole('img', { name: /Minimap/ })).toBeVisible();

  await a.context().close();
  await b.context().close();
});

test("moving player A changes A's position as seen by B", async ({ browser }) => {
  const a = await enterWorld(browser, { name: 'Walker', room: 'e2e-move' });
  const b = await enterWorld(browser, { name: 'Watcher', room: 'e2e-move' });
  const before = (await expectWorld(b, (w) => w.remotePlayers.length === 1, 'B sees A'))
    .remotePlayers[0]!;

  // Strafe left along the aisle, then wait until A has come to rest.
  await walkUntil(a, 'KeyA', (p) => p.x < before.x - 2.5);
  const aState = await waitUntilStill(a);
  expect(aState.player.x).toBeLessThan(before.x - 2);

  const seen = await expectWorld(
    b,
    (w) => {
      const remote = w.remotePlayers[0];
      return remote !== undefined && Math.abs(remote.x - aState.player.x) < 0.05;
    },
    "B should see A's new position",
  );
  expect(seen.remotePlayers[0]!.z).toBeCloseTo(aState.player.z, 1);
  // Prediction agreed with the server. Exact agreement is proven by unit tests; here a small
  // tolerance allows for a starved CI browser missing ticks, which the server then idle-steps.
  expect((await world(a)).prediction.maxCorrection).toBeLessThan(0.5);

  await a.context().close();
  await b.context().close();
});

test('chat from A arrives at B', async ({ browser }) => {
  const a = await enterWorld(browser, { name: 'Talker', room: 'e2e-chat' });
  const b = await enterWorld(browser, { name: 'Listener', room: 'e2e-chat' });
  await expectWorld(a, (w) => w.playerCount === 2, 'A sees B');

  await a.keyboard.press('Enter');
  await expect(a.getByRole('textbox', { name: 'Chat message' })).toBeFocused();
  await a.keyboard.type('<b>hello</b> kitchen!');
  await a.keyboard.press('Enter');

  const log = b.getByRole('list', { name: 'Chat history' });
  await expect(log).toContainText('Talker');
  await expect(log).toContainText('<b>hello</b> kitchen!');
  // Plain text only: the markup was not interpreted.
  await expect(log.locator('b')).toHaveCount(0);
  // The chat closed again and A is back in control.
  expect((await world(a)).mode).toBe('playing');

  // Clicking the world while typing ends the chat rather than leaving the keyboard stranded.
  await a.keyboard.press('Enter');
  await expectWorld(a, (w) => w.mode === 'chat', 'chat open');
  await a.locator('canvas.world-canvas').click({ position: { x: 480, y: 200 } });
  await expectWorld(a, (w) => w.mode === 'playing', 'clicking away closes chat');

  await a.context().close();
  await b.context().close();
});

test('a private room code isolates players', async ({ browser }) => {
  const lobby = await enterWorld(browser, { name: 'LobbyPerson' });
  const x = await enterWorld(browser, { name: 'SecretOne', room: 'Secret Base' });
  const y = await enterWorld(browser, { name: 'SecretTwo', room: 'secret-base' });

  await expectWorld(x, (w) => w.playerCount === 2, 'private room has both');
  const yState = await expectWorld(y, (w) => w.playerCount === 2, 'private room has both');
  expect(yState.room).toBe('secret-base');
  expect(yState.remotePlayers.map((p) => p.name)).toEqual(['SecretOne']);

  // Give the lobby a moment to (not) hear about them.
  await lobby.waitForTimeout(500);
  const lobbyState = await world(lobby);
  expect(lobbyState.playerCount).toBe(1);
  expect(lobbyState.remotePlayers).toEqual([]);

  for (const page of [lobby, x, y]) await page.context().close();
});

test("closing A drops B's count to 1", async ({ browser }) => {
  const a = await enterWorld(browser, { name: 'Leaver', room: 'e2e-leave' });
  const b = await enterWorld(browser, { name: 'Stayer', room: 'e2e-leave' });
  await expectWorld(b, (w) => w.playerCount === 2, 'B sees A');

  await a.context().close();

  await expectWorld(b, (w) => w.playerCount === 1, "B's count drops to 1");
  await expect(b.getByRole('list', { name: 'Chat history' })).toContainText('Leaver left');
  await b.context().close();
});

test('Esc closes an info panel and returns to play', async ({ browser }) => {
  const page = await enterWorld(browser, { name: 'Reader', room: 'e2e-panel' });
  // From the spawn by the dining room doors, round the west end of the pass into the line, then
  // up to the entremetier's side of the piano. Standing at the counter and looking straight ahead
  // puts the crosshair on the station.
  await walkUntil(page, 'KeyA', (p) => p.x < -5.3);
  await walkUntil(page, 'KeyW', (p) => p.z < 2.9);
  await walkUntil(page, 'KeyD', (p) => p.x > -2.6);
  await walkUntil(page, 'KeyW', (p) => p.z < 2.4);
  await waitUntilStill(page);
  await page.mouse.move(480, 270);
  await expect(page.locator('.prompt')).toHaveText('Press E to open Entremetier');

  await page.keyboard.press('KeyE');
  const dialog = page.getByRole('dialog', { name: 'Entremetier' });
  await expect(dialog).toBeVisible();
  expect((await world(page)).mode).toBe('panel');

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeHidden();
  await expectWorld(page, (w) => w.mode === 'playing', 'back to playing');

  // Esc opens the menu, and Esc again closes it.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeHidden();
  await expectWorld(page, (w) => w.mode === 'playing', 'resumed from the menu');
  await page.context().close();
});
