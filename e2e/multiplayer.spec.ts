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

  await a.context().close();
  await b.context().close();
});

test("moving player A changes A's position as seen by B", async ({ browser }) => {
  const a = await enterWorld(browser, { name: 'Walker', room: 'e2e-move' });
  const b = await enterWorld(browser, { name: 'Watcher', room: 'e2e-move' });
  const before = (await expectWorld(b, (w) => w.remotePlayers.length === 1, 'B sees A'))
    .remotePlayers[0]!;

  // Walk backwards (away from the fountain), then wait until A has come to rest.
  await walkUntil(a, 'KeyS', (p) => p.z > before.z + 2.5);
  const aState = await waitUntilStill(a);
  expect(aState.player.z).toBeGreaterThan(before.z + 2);

  const seen = await expectWorld(
    b,
    (w) => {
      const remote = w.remotePlayers[0];
      return remote !== undefined && Math.abs(remote.z - aState.player.z) < 0.05;
    },
    "B should see A's new position",
  );
  expect(seen.remotePlayers[0]!.x).toBeCloseTo(aState.player.x, 1);
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
  await a.keyboard.type('<b>hello</b> island!');
  await a.keyboard.press('Enter');

  const log = b.getByRole('list', { name: 'Chat history' });
  await expect(log).toContainText('Talker');
  await expect(log).toContainText('<b>hello</b> island!');
  // Plain text only: the markup was not interpreted.
  await expect(log.locator('b')).toHaveCount(0);
  // The chat closed again and A is back in control.
  expect((await world(a)).mode).toBe('playing');

  // Clicking the world while typing ends the chat rather than leaving the keyboard stranded.
  await a.keyboard.press('Enter');
  await expectWorld(a, (w) => w.mode === 'chat', 'chat open');
  await a.locator('canvas').click({ position: { x: 480, y: 200 } });
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
  // Walk from spawn to the About pedestal (north-west of the fountain) and look up at it.
  await walkUntil(page, 'KeyA', (p) => p.x < -4.3);
  await walkUntil(page, 'KeyW', (p) => p.z < -9);
  await waitUntilStill(page);
  const box = page.locator('canvas');
  await page.mouse.move(480, 400);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(480, 400 - i * 12);
  await page.mouse.up();
  await expect(page.locator('.prompt')).toHaveText('Click to open About');

  await box.click({ position: { x: 480, y: 270 } });
  const dialog = page.getByRole('dialog', { name: 'About' });
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

test('a round of tag starts from the menu in a private room', async ({ browser }) => {
  const a = await enterWorld(browser, { name: 'Host', room: 'e2e-tag' });
  const b = await enterWorld(browser, { name: 'Guest', room: 'e2e-tag' });
  await expectWorld(a, (w) => w.playerCount === 2, 'A sees B');

  await a.keyboard.press('Escape');
  await a.getByRole('button', { name: 'Play tag' }).click();

  for (const page of [a, b]) {
    const state = await expectWorld(page, (w) => w.game !== null, 'round is running');
    expect(state.game!.scores).toHaveLength(2);
    expect([state.selfId, ...state.remotePlayers.map((p) => p.id)]).toContain(state.game!.it);
    await expect(page.getByRole('region', { name: 'Tag scoreboard' })).toContainText(
      /is it|You're it/,
    );
  }
  expect((await world(a)).mode).toBe('playing');
  await a.context().close();
  await b.context().close();
});
