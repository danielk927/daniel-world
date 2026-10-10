import { expect, test, type Page } from '@playwright/test';
import { GRAVITY, JUMP_SPEED, SPRINT_SPEED, WALK_SPEED } from '@world/shared';
import { enterWorld, expectWorld, waitUntilStill } from './helpers.ts';

/** Hold `keys` down while the game runs `frames` frames, and return the fastest the cook went. */
async function fastestWhileHolding(page: Page, keys: string[], frames = 20): Promise<number> {
  for (const key of keys) await page.keyboard.down(key);
  try {
    return await page.evaluate(async (frames) => {
      let fastest = 0;
      const until = window.__world!.frames + frames;
      while (window.__world!.frames < until) {
        fastest = Math.max(fastest, window.__world!.player.speed);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }
      return fastest;
    }, frames);
  } finally {
    for (const key of keys.reverse()) await page.keyboard.up(key);
  }
}

test('Space jumps and the cook comes back down, and Shift sprints faster than a walk', async ({
  browser,
}) => {
  const page = await enterWorld(browser, { name: 'Athlete', online: false });
  const floor = (await waitUntilStill(page)).player.y;

  // Watch the whole jump from the page, every frame, so a slow page cannot miss the top of it.
  const top = page.evaluate(async () => {
    let highest = -Infinity;
    let airborne = false;
    for (;;) {
      const { grounded, y } = window.__world!.player;
      if (!grounded) airborne = true;
      else if (airborne) return highest;
      highest = Math.max(highest, y);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  });
  // Held down as a person presses a key, not tapped between two ticks.
  await page.keyboard.down('Space');
  await expectWorld(page, (w) => !w.player.grounded, 'the cook leaves the floor');
  await page.keyboard.up('Space');
  const height = (await top) - floor;
  // As high as the jump speed takes them against gravity, and no higher. The page sees the top of
  // the jump only as near as its frames come to it, which on a starved page can be a long way off.
  const full = JUMP_SPEED ** 2 / (2 * GRAVITY);
  expect(height).toBeGreaterThan(full / 2);
  expect(height).toBeLessThan(full + 0.01);
  expect((await waitUntilStill(page)).player.y).toBe(floor);

  // West along the aisle at a sprint, then back east at a walk.
  expect(await fastestWhileHolding(page, ['ShiftLeft', 'KeyA'])).toBeCloseTo(SPRINT_SPEED, 5);
  await waitUntilStill(page);
  expect(await fastestWhileHolding(page, ['KeyD'])).toBeCloseTo(WALK_SPEED, 5);
  await page.context().close();
});
