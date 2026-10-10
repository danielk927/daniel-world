import { expect, test, type Page } from '@playwright/test';
import { enterWorld, waitForFrames } from './helpers.ts';

/** Where keyboard focus is: inside the pause menu, and the name of what holds it. */
function focus(page: Page): Promise<{ inMenu: boolean; name: string }> {
  return page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    const menu = document.querySelector('[role="dialog"][aria-label="Paused"]');
    return {
      inMenu: !!active && !!menu?.contains(active),
      name: active?.getAttribute('aria-label') ?? active?.textContent?.trim() ?? '',
    };
  });
}

test('Tab and Shift+Tab stay in the pause menu, and only on what the keyboard can reach', async ({
  browser,
}) => {
  const page = await enterWorld(browser, { name: 'Tabber', online: false });
  await page.keyboard.press('Escape');
  const menu = page.getByRole('dialog', { name: 'Paused' });
  await expect(menu).toBeVisible();

  // On another tab than the first, so the first tab button is out of the Tab order.
  const knives = menu.getByRole('tab', { name: 'Knives' });
  await knives.click();
  await expect(knives).toBeFocused();

  // Back from the current tab, the first stop in the menu, round to the last: the plain portfolio.
  await page.keyboard.press('Shift+Tab');
  expect(await focus(page)).toEqual({ inMenu: true, name: 'Plain portfolio' });

  // And on from the last, round to the current tab, never to a tab the arrow keys own.
  await page.keyboard.press('Tab');
  expect(await focus(page)).toEqual({ inMenu: true, name: 'Knives' });

  // All the way round, Tab stops only on what shows, and never leaves the menu.
  const stops: string[] = [];
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    const now = await focus(page);
    expect(now.inMenu, `focus left the menu after ${stops.join(', ')}`).toBe(true);
    if (now.name === 'Knives') break;
    stops.push(now.name);
  }
  expect(stops).not.toContain('Party');
  expect(stops).not.toContain('Start party');
  expect(stops.at(-1)).toBe('Plain portfolio');
  await page.context().close();
});

test('the HUD, the prompt and the hit flash draw over the labels in the world', async ({
  browser,
}) => {
  const page = await enterWorld(browser, { name: 'Looker', online: false });
  const covered = await page.evaluate(() => {
    // Hit testing finds what is drawn on top, once everything takes the pointer.
    const style = document.createElement('style');
    style.textContent = '.ui, .ui * { pointer-events: auto !important; }';
    document.head.append(style);
    // A label as the label layer draws one, ranked over its neighbors as it ranks them.
    const probe = document.createElement('div');
    probe.className = 'label lore-label';
    probe.append(Object.assign(document.createElement('span'), { textContent: 'Probe' }));
    probe.style.cssText = 'opacity: 1; z-index: 40; transform: none;';
    document.querySelector('.labels')!.append(probe);
    const parts = ['.prompt kbd', '.hud-room-title', '.hud-player', '.minimap', '.impact-flash'];
    return parts.map((selector) => {
      const part = document.querySelector<HTMLElement>(selector)!;
      const box = part.getBoundingClientRect();
      const x = box.left + box.width / 2;
      const y = box.top + box.height / 2;
      probe.style.left = `${x - 20}px`;
      probe.style.top = `${y - 12}px`;
      const stack = document.elementsFromPoint(x, y);
      const partAt = stack.findIndex((node) => part.contains(node));
      const probeAt = stack.findIndex((node) => probe.contains(node));
      return { selector, over: partAt >= 0 && probeAt >= 0 && partAt < probeAt };
    });
  });
  expect(covered).toEqual(covered.map(({ selector }) => ({ selector, over: true })));
  await page.context().close();
});

test('the arrow keys move straight up and down the knife grid, however many columns it has', async ({
  browser,
}) => {
  const page = await enterWorld(browser, { name: 'Collector', online: false });
  await page.keyboard.press('Escape');
  const menu = page.getByRole('dialog', { name: 'Paused' });
  await menu.getByRole('tab', { name: 'Knives' }).click();
  const grid = menu.getByRole('radiogroup', { name: 'Knife' });

  /** Where the focused knife sits in the grid, by its box. */
  const focused = () =>
    page.evaluate(() => {
      const box = document.activeElement!.getBoundingClientRect();
      return { x: Math.round(box.left), y: Math.round(box.top) };
    });

  // Four across in a window, three across on a phone, which the menu turns into as it narrows.
  for (const width of [960, 600, 960]) {
    await page.setViewportSize({ width, height: 800 });
    // The grid counts its columns as it changes size, in the frame after the resize.
    await waitForFrames(page, 2);
    const first = grid.getByRole('radio').first();
    await first.click();
    await expect(first).toBeFocused();
    const start = await focused();
    await page.keyboard.press('ArrowDown');
    const below = await focused();
    expect(below.x, `ArrowDown at ${width} px keeps to the column`).toBe(start.x);
    expect(below.y).toBeGreaterThan(start.y);
    await page.keyboard.press('ArrowUp');
    expect(await focused(), `ArrowUp at ${width} px comes back`).toEqual(start);
  }
  await page.context().close();
});
