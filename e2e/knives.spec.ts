import { expect, test, type Page } from '@playwright/test';
import { enterWorld, expectWorld, startRoomServer, waitUntilStill, world } from './helpers.ts';

/** Turn the view to a yaw by dragging the mouse, the way a visitor without pointer lock looks around. */
async function turnTo(page: Page, yaw: number, pitch = 0): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const { look } = await world(page);
    const dYaw = look.yaw - yaw;
    const dPitch = pitch - look.pitch;
    if (Math.abs(dYaw) < 0.02 && Math.abs(dPitch) < 0.02) return;
    // Out and back, so even a tiny correction is a drag and never a click on a station.
    await page.mouse.move(480, 270);
    await page.mouse.down();
    await page.mouse.move(480, 210, { steps: 2 });
    const clamp = (v: number) => Math.max(-150, Math.min(150, v * 250));
    await page.mouse.move(480 + clamp(dYaw), 270 - clamp(dPitch), { steps: 3 });
    await page.mouse.up();
  }
  throw new Error(`could not turn to ${yaw}`);
}

/** Left click the world, as a visitor throws. A press that does not move is a click, not a look. */
async function throwKnife(page: Page): Promise<void> {
  await page.mouse.click(480, 270);
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
    await throwKnife(thrower);

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
    await throwKnife(thrower);
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
  await throwKnife(page);
  await expectWorld(page, (w) => w.knives.stuck === 1, 'the knife sticks in the floor');
  await page.context().close();
});

test('I inspects what is in hand, a throw cuts it short, and the loadout follows Q', async ({
  browser,
}) => {
  const page = await enterWorld(browser, { name: 'Inspector', online: false });
  const knife = page.locator('.loadout-knife');
  const hand = page.locator('.loadout-hand');
  await expect(knife).toHaveClass(/is-active/);
  await expect(hand).not.toHaveClass(/is-active/);

  await page.keyboard.press('KeyI');
  await expectWorld(page, (w) => w.inspecting, 'the knife is being inspected');
  await throwKnife(page);
  await expectWorld(
    page,
    (w) => !w.inspecting && w.knives.flying + w.knives.stuck === 1,
    'the throw cuts the inspect short',
  );

  await page.keyboard.press('KeyQ');
  await expectWorld(page, (w) => !w.armed, 'Q puts the knife away');
  await expect(hand).toHaveClass(/is-active/);
  await expect(knife).not.toHaveClass(/is-active/);
  // Mid-switch there is nothing to inspect yet; press again, as a person would, until it starts.
  await expect
    .poll(
      async () => {
        await page.keyboard.press('KeyI');
        return (await world(page)).inspecting;
      },
      { message: 'the bare hand is being inspected' },
    )
    .toBe(true);
  await expectWorld(page, (w) => !w.inspecting, 'the inspect ends by itself', 5000);

  // With the bare hand out, a click draws the knife rather than throwing one.
  await throwKnife(page);
  await expectWorld(page, (w) => w.armed, 'a click draws the knife');
  await expect(knife).toHaveClass(/is-active/);
  expect((await world(page)).knives.stuck).toBe(1);
  await page.context().close();
});
