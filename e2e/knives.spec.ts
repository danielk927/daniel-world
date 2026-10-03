import { expect, test, type Page } from '@playwright/test';
import { enterWorld, expectWorld, startRoomServer, waitUntilStill, world } from './helpers.ts';

/** Turn the view to a yaw by dragging the mouse, the way a visitor without pointer lock looks around. */
async function turnTo(page: Page, yaw: number, pitch = 0): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const { look } = await world(page);
    const dYaw = look.yaw - yaw;
    const dPitch = pitch - look.pitch;
    if (Math.abs(dYaw) < 0.02 && Math.abs(dPitch) < 0.02) return;
    await page.mouse.move(480, 270);
    await page.mouse.down();
    const clamp = (v: number) => Math.max(-150, Math.min(150, v * 250));
    await page.mouse.move(480 + clamp(dYaw), 270 - clamp(dPitch), { steps: 3 });
    await page.mouse.up();
  }
  throw new Error(`could not turn to ${yaw}`);
}

test('a knife knocks out the cook it hits, who gets back up somewhere else', async ({
  browser,
}) => {
  const server = await startRoomServer();
  try {
    const thrower = await enterWorld(browser, { name: 'Thrower', room: 'e2e-knives' });
    const target = await enterWorld(browser, { name: 'Target', room: 'e2e-knives' });
    await expectWorld(thrower, (w) => w.playerCount === 2, 'the thrower sees the target');
    const a = await waitUntilStill(thrower);
    const b = await waitUntilStill(target);
    // Both stand in the aisle by the dining room doors; face the target and throw.
    await turnTo(thrower, Math.atan2(-(b.player.x - a.player.x), -(b.player.z - a.player.z)));
    await thrower.keyboard.press('KeyF');

    await expectWorld(target, (w) => w.knockedOut, 'the target is knocked out');
    await expect(target.getByRole('status').filter({ hasText: 'Knocked out' })).toContainText(
      'by Thrower',
    );
    await expect(thrower.locator('.chat-log')).toContainText('You got Target');

    // Three seconds on the floor, then back up at a spawn point, somewhere new.
    const up = await expectWorld(target, (w) => !w.knockedOut, 'the target gets back up', 8000);
    expect(Math.hypot(up.player.x - b.player.x, up.player.z - b.player.z)).toBeGreaterThan(0.5);

    // A knife thrown at the floor stays there, and both cooks see it.
    await turnTo(thrower, (await world(thrower)).look.yaw, -1.2);
    await thrower.keyboard.press('KeyF');
    for (const page of [thrower, target]) {
      await expectWorld(page, (w) => w.knives.stuck === 1, 'a knife is stuck in the floor');
    }
    await thrower.context().close();
    await target.context().close();
  } finally {
    await server.close();
  }
});

test('knives stick where they land when playing solo', async ({ browser }) => {
  const page = await enterWorld(browser, { name: 'Solo', online: false });
  await turnTo(page, 0, -1.2);
  await page.keyboard.press('KeyF');
  await expectWorld(page, (w) => w.knives.stuck === 1, 'the knife sticks in the floor');
  await page.context().close();
});
