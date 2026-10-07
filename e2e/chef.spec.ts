import { expect, test } from '@playwright/test';
import type { WorldServer } from '../apps/server/src/server.ts';
import { enterWorld, expectWorld, startRoomServer, world } from './helpers.ts';

let server: WorldServer;

test.beforeAll(async () => {
  server = await startRoomServer();
});

test.afterAll(async () => {
  await server.close();
});

test('Chef Skinner walks the lobby and throws at a cook on the move', async ({ browser }) => {
  const page = await enterWorld(browser, { name: 'Pacer' });
  const chef = await expectWorld(
    page,
    (w) => w.remotePlayers.some((p) => p.name === 'Chef Skinner'),
    'Chef Skinner is in the lobby',
  );
  const start = chef.remotePlayers.find((p) => p.name === 'Chef Skinner')!;
  await expectWorld(
    page,
    (w) => {
      const now = w.remotePlayers.find((p) => p.name === 'Chef Skinner');
      return !!now && Math.hypot(now.x - start.x, now.z - start.z) > 1;
    },
    'he walks about',
  );

  // Pace the aisle by the dining room doors, as a visitor exploring would, until a knife of his
  // lands: in the room or in us. He leaves newcomers alone for a few seconds first.
  const thrown = (w: Awaited<ReturnType<typeof world>>) =>
    w.knives.stuck + w.knives.flying > 0 || w.knockedOut;
  // His wander is random and the hood or the pass can stand between us for a while, so allow up to
  // a minute and a half; it usually takes a quarter of that.
  for (let i = 0; i < 150 && !thrown(await world(page)); i++) {
    const key = i % 2 === 0 ? 'KeyA' : 'KeyD';
    await page.keyboard.down(key);
    await page.waitForTimeout(600);
    await page.keyboard.up(key);
  }
  expect(thrown(await world(page))).toBe(true);
  await page.context().close();
});
