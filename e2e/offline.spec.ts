import { expect, test } from '@playwright/test';
import { enterWorld, expectWorld, startRoomServer, walkUntil } from './helpers.ts';

test('with the server stopped the world still loads in single-player mode', async ({ browser }) => {
  // No room server is running for this test.
  const page = await enterWorld(browser, { name: 'Solo', online: false });
  const state = await expectWorld(page, (w) => w.connection === 'offline', 'should be offline');
  expect(state.playerCount).toBe(1);
  await expect(page.locator('.hud-status')).toContainText('solo mode');

  // The world is fully playable: walking works without a server.
  const before = state.player.z;
  await walkUntil(page, 'KeyS', (p) => p.z > before + 1.5);

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
