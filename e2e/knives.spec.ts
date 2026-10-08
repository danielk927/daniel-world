import { expect, test, type Page } from '@playwright/test';
import { knifeMoves } from '../apps/client/src/world/knifeMoves.ts';
import {
  enterWorld,
  expectWorld,
  startRoomServer,
  turnTo,
  waitUntilStill,
  world,
} from './helpers.ts';

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
    await expect(target.getByRole('status').filter({ hasText: 'Knocked out by' })).toContainText(
      'Thrower',
    );
    // The thrower sees their hit land under the crosshair; both see it in the kill feed.
    await expect(thrower.locator('.hit-banner')).toContainText('Target');
    for (const page of [thrower, target]) {
      await expect(page.locator('.kill-feed')).toContainText('Thrower knocked out Target');
    }

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

/** Click until the bare hand punches; mid-switch, a click does nothing yet. */
async function punch(page: Page): Promise<void> {
  await expect
    .poll(
      async () => {
        await throwKnife(page);
        return (await world(page)).punching;
      },
      { message: 'the bare hand punches' },
    )
    .toBe(true);
}

test('I inspects the knife, a throw cuts it short, and the fist punches instead', async ({
  browser,
}) => {
  const page = await enterWorld(browser, { name: 'Inspector', online: false });
  const knife = page.locator('.loadout-knife');
  const hand = page.locator('.loadout-hand');
  await expect(knife).toHaveClass(/is-active/);
  await expect(hand).not.toHaveClass(/is-active/);

  await page.keyboard.press('KeyI');
  // I is taken while the knife is still coming up into view, but a throw waits until it is up
  // (0.22 s at most after the inspect starts), so click only once it is.
  await expectWorld(
    page,
    (w) => w.inspecting && (w.inspectTime ?? 0) > 0.3,
    'the knife is up and being inspected',
  );
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

  // With the bare hand out, a click punches: the knife stays away and nothing is thrown.
  await punch(page);
  await expectWorld(page, (w) => !w.punching, 'the punch comes back');
  const after = await world(page);
  expect(after.armed).toBe(false);
  expect(after.knives.flying + after.knives.stuck).toBe(1);

  // There is nothing to inspect on a bare hand.
  await page.keyboard.press('KeyI');
  await page.waitForTimeout(300);
  expect((await world(page)).inspecting).toBe(false);

  await page.keyboard.press('KeyQ');
  await expectWorld(page, (w) => w.armed, 'Q draws the knife again');
  await expect(knife).toHaveClass(/is-active/);
  await page.context().close();
});

test('every press of I starts the inspect over, but holding I down does not', async ({
  browser,
}) => {
  const page = await enterWorld(browser, { name: 'Twirler', online: false });
  await page.keyboard.press('KeyI');
  const first = await expectWorld(page, (w) => (w.inspectTime ?? 0) > 1, 'the inspect plays on');
  await page.keyboard.press('KeyI');
  await expectWorld(
    page,
    (w) => w.inspectTime !== null && w.inspectTime < first.inspectTime!,
    'a second press starts it over',
  );
  // Past where the first would have ended, the second plays on.
  const inspect = knifeMoves('kitchen').inspect.duration;
  await expectWorld(
    page,
    (w) => (w.inspectTime ?? 0) > inspect - first.inspectTime! + 0.3,
    'the second inspect plays past where the first would have ended',
  );
  await expectWorld(page, (w) => !w.inspecting, 'the second inspect ends');

  // Held down, the key repeats, and that is not pressing it again. A press starts the inspect over
  // as it is handled, so had a repeat done so, it would read 0 straight after; a frame may not
  // have passed since, so it need not have moved on either.
  await page.keyboard.down('KeyI');
  const held = await expectWorld(page, (w) => (w.inspectTime ?? 0) > 0.5, 'holding I inspects');
  for (let i = 0; i < 5; i++) await page.keyboard.down('KeyI');
  expect((await world(page)).inspectTime).toBeGreaterThanOrEqual(held.inspectTime!);
  await page.keyboard.up('KeyI');
  await page.context().close();
});

test('other cooks see a punch', async ({ browser }) => {
  const server = await startRoomServer();
  try {
    const boxer = await enterWorld(browser, { name: 'Boxer', room: 'e2e-punch' });
    const watcher = await enterWorld(browser, { name: 'Watcher', room: 'e2e-punch' });
    await expectWorld(watcher, (w) => w.playerCount === 2, 'the watcher sees the boxer');
    await boxer.keyboard.press('KeyQ');
    await expectWorld(boxer, (w) => !w.armed, 'the boxer puts the knife away');
    await punch(boxer);
    await expectWorld(
      watcher,
      (w) => (w.remotePlayers[0]?.punches ?? 0) >= 1,
      'the watcher sees the punch',
    );
    await boxer.context().close();
    await watcher.context().close();
  } finally {
    await server.close();
  }
});
