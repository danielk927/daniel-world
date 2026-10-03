import { expect, test } from '@playwright/test';
import { WebSocketServer } from 'ws';
import { CLOSE_BAD_HELLO } from '../apps/server/src/server.ts';
import { enterWorld, expectWorld, startRoomServer, walkUntil } from './helpers.ts';
import { E2E_SERVER_PORT } from './ports.ts';

test('with the server stopped the world still loads in single-player mode', async ({ browser }) => {
  // No room server is running for this test.
  const page = await enterWorld(browser, { name: 'Solo', online: false });
  const state = await expectWorld(page, (w) => w.connection === 'offline', 'should be offline');
  expect(state.playerCount).toBe(1);
  await expect(page.locator('.hud-status')).toContainText('solo mode');

  // The world is fully playable: walking works without a server.
  const before = state.player.x;
  await walkUntil(page, 'KeyA', (p) => p.x < before - 1.5);

  // When the server comes back, the client reconnects on its own.
  const server = await startRoomServer();
  try {
    await expectWorld(page, (w) => w.connection === 'online', 'should reconnect', 30_000);
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
  outdated.on('connection', (socket) => {
    socket.on('message', () => {
      const error = { t: 'error', code: 'version', message: 'Please reload the page to update.' };
      socket.send(JSON.stringify(error));
      socket.close(CLOSE_BAD_HELLO, 'version');
    });
  });
  const page = await enterWorld(browser, { name: 'Early Bird', online: false });
  try {
    await expectWorld(page, (w) => w.connection === 'offline', 'should be offline');
    await expect(page.locator('.hud-status')).toContainText('solo mode');
    // Still in the kitchen, not sent back to the landing screen.
    await page.waitForTimeout(1500);
    await expectWorld(page, (w) => w.mode === 'playing', 'should still be playing');

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
