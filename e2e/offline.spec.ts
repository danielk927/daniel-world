import { WebSocketServer } from 'ws';
import { CLOSE_BAD_HELLO } from '../apps/server/src/server.ts';
import {
  enterWorld,
  expect,
  expectWorld,
  startRoomServer,
  test,
  waitForFrames,
  walkUntil,
  world,
} from './helpers.ts';
import { E2E_SERVER_PORT } from './ports.ts';

test('with the server stopped the world still loads in single-player mode', async ({ browser }) => {
  // No room server is running for this test.
  const page = await enterWorld(browser, { name: 'Solo', online: false });
  const state = await expectWorld(page, (w) => w.connection === 'offline', 'should be offline');
  expect(state.playerCount).toBe(1);
  await expect(page.locator('.hud-status')).toHaveText('Solo');

  // The world is fully playable: walking works without a server.
  const before = state.player.x;
  await walkUntil(page, 'KeyA', (p) => p.x < before - 1.5);

  // Parties need the server, and the menu says so rather than failing quietly.
  await page.keyboard.press('Escape');
  const menu = page.getByRole('dialog', { name: 'Paused' });
  const start = menu.getByRole('button', { name: 'Start party' });
  await expect(menu.locator('#party-code-status')).toContainText('The server is unreachable');
  await expect(start).toHaveAttribute('aria-disabled', 'true');

  // When the server comes back, the client reconnects on its own.
  const server = await startRoomServer();
  try {
    await expectWorld(page, (w) => w.connection === 'online', 'should reconnect', 30_000);
    // The menu, still open, opens parties up again.
    await expect(start).toHaveAttribute('aria-disabled', 'false');
    await expect(menu.locator('#party-code-status')).not.toContainText('unreachable');
    await page.keyboard.press('Escape');
    await expect(page.locator('.hud-status')).toContainText('Online');
    // Back in a real room, with an id from the server.
    await expectWorld(page, (w) => w.selfId !== null, 'has a server id');
  } finally {
    await page.context().close();
    await server.close();
  }
});

test('a room server on another protocol version still lets visitors in, solo', async ({
  browser,
}) => {
  // A server from an older or newer deploy: it turns down every hello as the real one does.
  const outdated = new WebSocketServer({ port: E2E_SERVER_PORT, host: '127.0.0.1' });
  let hellos = 0;
  outdated.on('connection', (socket) => {
    socket.on('message', () => {
      hellos++;
      const error = { t: 'error', code: 'version', message: 'Please reload the page to update.' };
      socket.send(JSON.stringify(error));
      socket.close(CLOSE_BAD_HELLO, 'version');
    });
  });
  const page = await enterWorld(browser, { name: 'Early Bird', online: false });
  try {
    await expectWorld(page, (w) => w.connection === 'offline', 'should be offline');
    await expect(page.locator('.hud-status')).toHaveText('Solo · updating');
    // Still in the kitchen, not sent back to the landing screen, even once turned away again: a
    // third hello means the page has heard the second refusal and tried once more.
    await expect.poll(() => hellos, { timeout: 15_000 }).toBeGreaterThanOrEqual(3);
    await waitForFrames(page, 10);
    expect((await world(page)).mode).toBe('playing');

    // Once the server is redeployed on the same version, the client joins on its own.
    await new Promise<void>((resolve) => outdated.close(() => resolve()));
    const server = await startRoomServer();
    try {
      await expectWorld(page, (w) => w.connection === 'online', 'should connect', 30_000);
    } finally {
      await server.close();
    }
  } finally {
    await page.context().close();
    outdated.close();
  }
});

test('cooks in a private party find each other again after the server restarts', async ({
  browser,
}) => {
  let server = await startRoomServer();
  try {
    // One starts the party from the menu, the other comes in with its code from the landing.
    const host = await enterWorld(browser, { name: 'Host' });
    await host.keyboard.press('Escape');
    const menu = host.getByRole('dialog', { name: 'Paused' });
    await menu.getByLabel('Party code').fill('e2e-restart');
    await menu.getByRole('button', { name: 'Start party' }).click();
    await expectWorld(host, (w) => w.room === 'e2e-restart', 'the host is in the party');
    await menu.getByRole('button', { name: 'Resume' }).click();
    const guest = await enterWorld(browser, { name: 'Guest', room: 'e2e-restart' });
    const cooks = [host, guest];
    for (const page of cooks) {
      await expectWorld(page, (w) => w.playerCount === 2, 'both are in the party');
    }
    const stood = (await world(host)).player;

    // A redeploy: the server goes away with every room in it, and comes back empty.
    await server.close();
    for (const page of cooks) {
      await expectWorld(page, (w) => w.connection === 'offline', 'the cook plays solo meanwhile');
    }
    server = await startRoomServer();

    // Both go back into the party on their own, whoever is first opening it again, and nobody
    // else is there: no lobby, no Chef Skinner.
    for (const [page, other] of [
      [host, 'Guest'],
      [guest, 'Host'],
    ] as const) {
      const back = await expectWorld(
        page,
        (w) => w.connection === 'online' && w.room === 'e2e-restart' && w.playerCount === 2,
        'back in the party together',
        30_000,
      );
      expect(back.remotePlayers.map((p) => p.name)).toEqual([other]);
    }
    // Where they were standing, not back at a spawn point.
    const now = (await world(host)).player;
    expect(Math.hypot(now.x - stood.x, now.z - stood.z)).toBeLessThan(0.01);
    await expect(host.locator('.hud-room-name')).toHaveText('#e2e-restart');
    for (const page of cooks) await page.context().close();
  } finally {
    await server.close();
  }
});
