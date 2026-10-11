import type { Page } from '@playwright/test';
import { MAX_HEALTH } from '@world/shared';
import {
  enterWorld,
  expect,
  expectWorld,
  hitUntil,
  startRoomServer,
  test,
  waitForFrames,
  world,
} from './helpers.ts';

/** The health bar, a meter with the number in its accessible value. */
const bar = (page: Page) => page.getByRole('meter', { name: 'Health' });

/**
 * Start writing down every class the page's `selector` element has worn, to see a cue that comes
 * and goes faster than a test can look for it.
 */
async function watchClasses(page: Page, selector: string): Promise<void> {
  await page.evaluate((selector) => {
    const seen = new Set<string>();
    const node = document.querySelector(selector)!;
    for (const name of node.classList) seen.add(name);
    new MutationObserver(() => {
      for (const name of node.classList) seen.add(name);
    }).observe(node, { attributes: true, attributeFilter: ['class'] });
    (window as unknown as Record<string, Set<string>>)[`seen ${selector}`] = seen;
  }, selector);
}

/** Whether the element has ever worn `className` since `watchClasses`. */
function wore(page: Page, selector: string, className: string): Promise<boolean> {
  return page.evaluate(
    ([selector, className]) =>
      (window as unknown as Record<string, Set<string>>)[`seen ${selector}`]!.has(className!),
    [selector, className],
  );
}

test('the health bar sits by the knife, whole, from the start, in solo play too', async ({
  browser,
}) => {
  const page = await enterWorld(browser, { name: 'Solo', online: false });
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toHaveAttribute('aria-valuenow', String(MAX_HEALTH));
  await expect(bar(page)).toHaveAttribute('aria-valuetext', '3 of 3');
  await expect(page.locator('.health-segment.is-full')).toHaveCount(MAX_HEALTH);
  expect((await world(page)).health).toBe(MAX_HEALTH);

  // In the bottom right corner, under the knife and beside nothing else of the HUD.
  const view = page.viewportSize()!;
  const health = (await bar(page).boundingBox())!;
  const knife = (await page.locator('.loadout').boundingBox())!;
  expect(health.x + health.width).toBeLessThanOrEqual(view.width);
  expect(health.y + health.height).toBeLessThanOrEqual(view.height);
  expect(health.x).toBeGreaterThan(view.width / 2);
  expect(health.y).toBeGreaterThan(view.height / 2);
  // The same edge as the knife, close under or over it.
  expect(Math.abs(health.x + health.width - (knife.x + knife.width))).toBeLessThan(40);
  expect(Math.abs(health.y - (knife.y + knife.height))).toBeLessThan(80);

  // It is a meter for a reader of the page too: the number is in it, and it is always there.
  await page.keyboard.press('Escape');
  await expectWorld(page, (w) => w.mode === 'paused', 'the menu opens');
  await page.keyboard.press('Escape');
  await expectWorld(page, (w) => w.mode === 'playing', 'back in the kitchen');
  await expect(bar(page)).toBeVisible();
  await page.context().close();
});

test("a knife takes one of a cook's three health, and the third knocks them out", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const room = 'e2e-health';
  const server = await startRoomServer();
  try {
    const thrower = await enterWorld(browser, { name: 'Thrower', room });
    const target = await enterWorld(browser, { name: 'Target', room });
    const watcher = await enterWorld(browser, { name: 'Watcher', room });
    await expectWorld(thrower, (w) => w.playerCount === 3, 'everyone sees everyone');
    await expectWorld(target, (w) => w.health === MAX_HEALTH, 'the target starts whole');
    await expect(bar(target)).toHaveAttribute('aria-valuetext', '3 of 3');
    await watchClasses(target, '.impact-flash');
    await watchClasses(thrower, '.hit-marker');
    const healthOf = async (): Promise<number | undefined> =>
      (await server.room(room))?.players.find((p) => p.name === 'Target')?.health;

    // One hit: two health left, the target on their feet, with a flare of the screen's edges and
    // the segment gone from the bar; the thrower sees their knife land on the crosshair, and
    // nothing says anyone was knocked out.
    await hitUntil(server, room, thrower, target, 2);
    expect(await healthOf()).toBe(2);
    await expectWorld(target, (w) => w.health === 2, 'the bar shows two');
    await expect(bar(target)).toHaveAttribute('aria-valuetext', '2 of 3');
    await expect(target.locator('.health-segment.is-full')).toHaveCount(2);
    await expect(target.locator('.health')).toHaveAttribute('data-health', '2');
    expect((await world(target)).knockedOut).toBe(false);
    expect(await wore(target, '.impact-flash', 'is-hurt')).toBe(true);
    expect(await wore(target, '.impact-flash', 'is-playing')).toBe(false);
    expect(await wore(thrower, '.hit-marker', 'is-playing')).toBe(true);
    await expect(target.getByRole('status').filter({ hasText: 'Hit.' })).toHaveText(
      'Hit. 2 health left.',
    );
    await expect(thrower.locator('.hit-banner')).not.toHaveClass(/is-visible/);
    for (const page of [thrower, target, watcher]) {
      await expect(page.locator('.kill-feed .kill')).toHaveCount(0);
    }

    // The next: the last one left, which the bar says in the warning color.
    await hitUntil(server, room, thrower, target, 1);
    expect(await healthOf()).toBe(1);
    await expectWorld(target, (w) => w.health === 1, 'the bar shows one');
    await expect(bar(target)).toHaveAttribute('aria-valuetext', '1 of 3');
    await expect(target.locator('.health')).toHaveAttribute('data-health', '1');
    await expect(target.getByRole('status').filter({ hasText: 'Hit.' })).toHaveText(
      'Hit. 1 health left, one more knocks you out.',
    );
    expect((await world(target)).knockedOut).toBe(false);

    // Nobody has been told of a knockout, and a knife that hit a cook sticks nowhere: the others
    // see it go into them, as it does into a cook who falls.
    for (const page of [thrower, target, watcher]) {
      await waitForFrames(page, 3);
      const { knives } = await world(page);
      expect(knives.stuck, 'no knife stuck anywhere').toBe(0);
      await expect(page.locator('.kill-feed .kill')).toHaveCount(0);
    }

    // The third takes the last: knocked out, as a knife has always done, and the bar empty.
    await hitUntil(server, room, thrower, target, 0);
    await expectWorld(target, (w) => w.knockedOut, 'the target is knocked out');
    expect((await world(target)).health).toBe(0);
    await expect(bar(target)).toHaveAttribute('aria-valuetext', '0 of 3');
    await expect(target.locator('.health-segment.is-full')).toHaveCount(0);
    expect(await wore(target, '.impact-flash', 'is-playing')).toBe(true);
    await expect(thrower.locator('.hit-banner')).toContainText('Target');
    for (const page of [thrower, target, watcher]) {
      await expect(page.locator('.kill-feed')).toContainText('Thrower knocked out Target');
    }

    // Back up, with all of it, and no memory of the hits: one hit now is one hit.
    await expectWorld(target, (w) => !w.knockedOut && w.health === MAX_HEALTH, 'up, whole', 10_000);
    await expect(bar(target)).toHaveAttribute('aria-valuetext', '3 of 3');
    expect(await healthOf()).toBe(MAX_HEALTH);
    await hitUntil(server, room, thrower, target, 2);
    await expectWorld(target, (w) => w.health === 2, 'one hit, two left');
    expect((await world(target)).knockedOut).toBe(false);

    // Nothing brings it back on its own.
    await waitForFrames(target, 120);
    expect((await world(target)).health).toBe(2);
    for (const page of [thrower, target, watcher]) await page.context().close();
  } finally {
    await server.close();
  }
});
