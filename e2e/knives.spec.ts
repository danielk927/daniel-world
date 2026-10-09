import { expect, test, type Browser, type Page } from '@playwright/test';
import {
  EYE_HEIGHT,
  KNIFE_MAX_FLIGHT_SECONDS,
  KNIFE_SPREAD,
  flyKnife,
  launchKnife,
} from '@world/shared';
import { knifeMoves } from '../apps/client/src/world/knifeMoves.ts';
import {
  enterWorld,
  expectWorld,
  startRoomServer,
  turnTo,
  waitUntilStill,
  world,
} from './helpers.ts';

type Point = { readonly x: number; readonly y: number; readonly z: number };

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

/**
 * Two cooks in a fresh party, the second (by arrival, so always at the same spawn point) knocked
 * out by the first, who throws from where they stand. Returns once the target is down.
 */
async function knockOutInParty(
  browser: Browser,
  room: string,
): Promise<{ thrower: Page; target: Page }> {
  const thrower = await enterWorld(browser, { name: 'Thrower', room });
  const target = await enterWorld(browser, { name: 'Target', room });
  await expectWorld(thrower, (w) => w.playerCount === 2, 'the thrower sees the target');
  const a = await waitUntilStill(thrower);
  const b = await waitUntilStill(target);
  await turnTo(thrower, Math.atan2(-(b.player.x - a.player.x), -(b.player.z - a.player.z)));
  await throwKnife(thrower);
  const down = await expectWorld(target, (w) => w.knockedOut, 'the target is knocked out');
  expect(down.arm).toBe(false);
  expect(down.labels).toBe(false);
  return { thrower, target };
}

test('a cook who gets back up with the menu open finds the arm only once it closes', async ({
  browser,
}) => {
  const server = await startRoomServer();
  try {
    const { thrower, target } = await knockOutInParty(browser, 'e2e-up');
    await target.keyboard.press('Escape');
    await expectWorld(target, (w) => w.mode === 'paused', 'the menu opens');
    // The respawn arrives under the menu: nothing comes up behind it.
    const up = await expectWorld(target, (w) => !w.knockedOut, 'the target gets back up', 8000);
    expect(up.mode).toBe('paused');
    expect(up.arm).toBe(false);
    expect(up.labels).toBe(false);
    await target.keyboard.press('Escape');
    await expectWorld(target, (w) => w.mode === 'playing' && w.arm && w.labels, 'up and armed');
    await thrower.context().close();
    await target.context().close();
  } finally {
    await server.close();
  }
});

test('a cook knocked out sees no labels and opens no station until back up', async ({
  browser,
}) => {
  const server = await startRoomServer();
  try {
    const { thrower, target } = await knockOutInParty(browser, 'e2e-down');
    // Into the menu and straight back out, still on the floor: the labels stay away.
    await target.keyboard.press('Escape');
    await expectWorld(target, (w) => w.mode === 'paused', 'the menu opens');
    await target.keyboard.press('Escape');
    const back = await expectWorld(target, (w) => w.mode === 'playing', 'the menu closes');
    expect(back.knockedOut).toBe(true);
    expect(back.labels).toBe(false);

    // For the rest of the time down, the cursor goes over the view from the floor, where stations
    // are in sight, and E is pressed on anything that gets picked: nothing does, and nothing opens.
    const picked = await target.evaluate(async () => {
      const prompt = document.querySelector('.prompt-sentence')!;
      const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
      const found: string[] = [];
      for (let i = 0; window.__world!.knockedOut; i++) {
        const x = 40 + ((i * 120) % 960);
        const y = 30 + ((Math.floor(i / 8) * 80) % 480);
        document.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }));
        await frame();
        const text = prompt.textContent ?? '';
        if (!text.startsWith('Press E to open') || !window.__world!.knockedOut) continue;
        window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE', key: 'e' }));
        window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyE', key: 'e' }));
        await frame();
        found.push(`${text} at ${x},${y}, ${window.__world!.mode}`);
        if (window.__world!.mode === 'panel') break;
      }
      return found;
    });
    expect(picked).toEqual([]);
    // Up again, they come back.
    await expectWorld(target, (w) => !w.knockedOut && w.labels, 'up, with the labels', 8000);
    await thrower.context().close();
    await target.context().close();
  } finally {
    await server.close();
  }
});

test('knives scatter a little round the crosshair, each sticking where its thrower saw it fly', async ({
  browser,
}) => {
  const server = await startRoomServer();
  try {
    const thrower = await enterWorld(browser, { name: 'Thrower', room: 'e2e-spread' });
    const watcher = await enterWorld(browser, { name: 'Watcher', room: 'e2e-spread' });
    await expectWorld(thrower, (w) => w.playerCount === 2, 'the thrower sees the watcher');
    await waitUntilStill(thrower);
    // Down the aisle, away from the watcher, at the bare wall high over the kitchen computer.
    await turnTo(thrower, Math.PI / 2, 0.2);
    const { player, look } = await world(thrower);
    const throws = 5;
    for (let i = 1; i <= throws; i++) {
      // A click while the arm is still throwing does nothing, so click until the next knife goes.
      await expect
        .poll(
          async () => {
            await throwKnife(thrower);
            return (await world(thrower)).knives.stuck;
          },
          { message: `knife ${i} sticks`, timeout: 15_000 },
        )
        .toBeGreaterThanOrEqual(i);
    }
    for (const page of [thrower, watcher]) {
      const w = await expectWorld(
        page,
        (w) => w.knives.stuck >= throws && w.knives.flying === 0,
        'every knife has stuck',
      );
      // Each stuck where this screen flew it: the thrower's launched its own knives before the
      // server heard of them, the watcher's replayed the server's, and all three agree.
      expect(w.knives.maxCorrection).toBeLessThan(0.01);
    }

    // Where a knife dead on the crosshair sticks.
    const eye = { x: player.x, y: player.y + EYE_HEIGHT, z: player.z };
    const aimed = launchKnife(eye.x, eye.y, eye.z, look.yaw, look.pitch);
    const dead = flyKnife(aimed, KNIFE_MAX_FLIGHT_SECONDS, [], -1);
    if (!dead) throw new Error('a knife on the crosshair sticks nowhere');
    const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    const reach = distance(eye, dead) * Math.tan(KNIFE_SPREAD);
    const { tips } = (await world(thrower)).knives;
    // Round it, within the spread, and scattered: never two in one hole, as knives thrown from one
    // spot with one aim used to be.
    for (const tip of tips) expect(distance(tip, dead)).toBeLessThan(reach + 0.02);
    const apart = tips.flatMap((a, i) => tips.slice(i + 1).map((b) => distance(a, b)));
    expect(Math.min(...apart)).toBeGreaterThan(0);
    expect(Math.max(...apart)).toBeGreaterThan(reach / 4);
    await thrower.context().close();
    await watcher.context().close();
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
