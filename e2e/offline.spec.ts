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
