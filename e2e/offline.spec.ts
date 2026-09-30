import { expect, test } from '@playwright/test';
import { enterWorld, expectWorld, hold, startRoomServer, world } from './helpers.ts';

test('with the server stopped the world still loads in single-player mode', async ({ browser }) => {
  // No room server is running for this test.
  const page = await enterWorld(browser, { name: 'Solo', online: false });
  const state = await expectWorld(page, (w) => w.connection === 'offline', 'should be offline');
  expect(state.playerCount).toBe(1);
  await expect(page.getByRole('status').filter({ hasText: 'Offline' })).toContainText('solo mode');

  // The world is fully playable: walking works without a server.
  const before = state.player.z;
  await hold(page, 'KeyS', 800);
  expect((await world(page)).player.z).toBeGreaterThan(before + 1.5);

  // When the server comes back, the client reconnects on its own.
  const server = await startRoomServer();
  try {
    await expectWorld(page, (w) => w.connection === 'online', 'should reconnect', 30_000);
    await expect(page.getByRole('status').filter({ hasText: 'Online' })).toBeVisible();
    // Back in a real room: the player list now comes from the server.
    expect((await world(page)).selfId).not.toBeNull();
  } finally {
    await page.context().close();
    await server.close();
  }
});
