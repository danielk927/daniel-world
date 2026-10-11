import { expect, test, type Page } from '@playwright/test';
import { enterWorld, turnTo, waitForFrames, world } from './helpers.ts';

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

type Box = { left: number; top: number; right: number; bottom: number };

/** Where the parts of the HUD's corners are, in CSS pixels. */
function hudBoxes(page: Page) {
  return page.evaluate(() => {
    const box = (selector: string): Box => {
      const { left, top, right, bottom } = document
        .querySelector(selector)!
        .getBoundingClientRect();
      return { left, top, right, bottom };
    };
    return {
      view: { width: window.innerWidth, height: window.innerHeight },
      map: box('.minimap'),
      north: box('.minimap-north'),
      room: box('.hud-room'),
      title: box('.hud-room-title'),
      players: box('.hud-players'),
      chat: box('.chat'),
      corner: box('.hud-corner'),
      loadout: box('.loadout'),
      mapParent: document.querySelector('.minimap')!.parentElement!.className,
      cornerHoldsMap: !!document.querySelector('.hud-corner .minimap'),
    };
  });
}

const overlap = (a: Box, b: Box): boolean =>
  a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Resize the window and wait for the HUD to be laid out for it, in the frame after. */
async function resize(page: Page, width: number, height: number): Promise<void> {
  await page.setViewportSize({ width, height });
  await waitForFrames(page, 2);
}

test('the minimap is in the top left corner with the room beside it, and the loadout has the bottom right to itself', async ({
  browser,
}) => {
  const page = await enterWorld(browser, { name: 'Mapper', online: false });

  for (const [width, height] of [
    [1280, 720],
    [1920, 1080],
    [960, 540],
  ] as const) {
    await resize(page, width, height);
    const at = await hudBoxes(page);
    const where = `at ${width}x${height}`;

    // In the corner: the north tab's top and the map's left sit on the HUD's edge, as the chat's
    // left and the players' top do, and the map lies in the top left of the window.
    expect(at.mapParent, `the map is in the HUD's top left slot ${where}`).toBe('hud-map');
    expect(at.map.left, `the map's left edge is the chat's ${where}`).toBeCloseTo(at.chat.left, 0);
    expect(at.north.top, `the north tab's top is the players' top ${where}`).toBeCloseTo(
      at.players.top,
      0,
    );
    expect(at.map.right, `the map stays in the left of the window ${where}`).toBeLessThan(
      at.view.width / 4,
    );
    expect(at.map.bottom, `the map stays in the top of the window ${where}`).toBeLessThan(
      at.view.height / 2,
    );

    // The room name and status beside it, never over it, nor under it, nor over the players.
    expect(at.title.left, `the room starts after the map ${where}`).toBeGreaterThanOrEqual(
      at.map.right + 16,
    );
    expect(at.room.bottom, `the room is beside the map, not under it ${where}`).toBeLessThan(
      at.map.bottom,
    );
    expect(overlap(at.room, at.map), `the room is clear of the map ${where}`).toBe(false);
    expect(overlap(at.room, at.players), `the room is clear of the players ${where}`).toBe(false);
    expect(overlap(at.room, at.chat), `the room is clear of the chat ${where}`).toBe(false);
    expect(overlap(at.map, at.chat), `the map is clear of the chat ${where}`).toBe(false);

    // The loadout is alone in the bottom right, its edge the players'.
    expect(at.cornerHoldsMap, `the minimap is not in the corner ${where}`).toBe(false);
    expect(at.loadout.right, `the loadout's right edge is the players' ${where}`).toBeCloseTo(
      at.players.right,
      0,
    );
    expect(at.corner.bottom, `the loadout rests on the bottom edge ${where}`).toBeCloseTo(
      at.view.height - (at.view.width - at.players.right),
      0,
    );
  }

  // The room comes first in the page, so a screen reader says where it is before the map's picture.
  const order = await page.evaluate(() =>
    [...document.querySelector('.hud-left')!.children].map((child) => child.className),
  );
  expect(order).toEqual(['hud-room', 'hud-map']);

  // A menu covers the left side with its own dark, and names the room itself: the map and the room
  // give way to it.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Paused' })).toBeVisible();
  await expect(page.locator('.minimap')).toBeHidden();
  await expect(page.locator('.hud-room-title')).toBeHidden();
  await page.context().close();
});

test('a long party code, and a notice at the top middle, never meet the room name', async ({
  browser,
}) => {
  const page = await enterWorld(browser, { name: 'Reader', online: false });
  // A party's longest code, as the room's title says it.
  await page.evaluate(() => {
    document.querySelector('.hud-room-name')!.textContent = '#friday-service-night-abc';
    document.querySelector<HTMLElement>('.hud-room-kind')!.hidden = false;
  });

  for (const [width, height] of [
    [800, 600],
    [960, 540],
    [1024, 640],
    [1280, 720],
    [1440, 900],
    [1920, 1080],
  ] as const) {
    await resize(page, width, height);
    const where = `at ${width}x${height}`;
    // The notice a visitor most often sees ("Reconnected"), as the game shows it, at the middle.
    const toast = await page.evaluate(() => {
      const notice = Object.assign(document.createElement('div'), {
        className: 'toast',
        textContent: 'Reconnected',
      });
      document.querySelector('.toasts')!.append(notice);
      const { left, top, right, bottom } = notice.getBoundingClientRect();
      notice.remove();
      return { left, top, right, bottom };
    });
    const at = await hudBoxes(page);
    expect(overlap(at.room, toast), `the room is clear of a notice ${where}`).toBe(false);
    expect(overlap(at.map, toast), `the map is clear of a notice ${where}`).toBe(false);
    // Stopped short of the players' column, which can be as wide as a third of the window.
    expect(at.title.right, `the code stops short of the players ${where}`).toBeLessThanOrEqual(
      at.players.right - 0.3 * at.view.width,
    );
    // Cut short with an ellipsis, up to the widest window, where it all fits.
    expect(
      await page.locator('.hud-room-title').evaluate((n) => n.scrollWidth > n.clientWidth),
      `the code is cut short ${where}`,
    ).toBe(width < 1920);
  }
  await page.context().close();
});

test('the open chat never runs over the map, and a window too short for both loses the map', async ({
  browser,
}) => {
  const page = await enterWorld(browser, { name: 'Talker', online: false });
  // A long history, as the open chat shows it: it fills a third of the window's height.
  await page.evaluate(() => {
    const log = document.querySelector('.chat-log')!;
    for (let i = 0; i < 40; i++) {
      const line = document.createElement('li');
      line.className = 'chat-line';
      line.textContent = `line ${i}: the quick brown fox jumps over the lazy dog while the sauce reduces`;
      log.append(line);
    }
  });
  await page.keyboard.press('Enter');
  await expect(page.locator('.chat.is-open')).toBeVisible();

  for (const [width, height] of [
    [1280, 720],
    [1280, 540],
    [1440, 521],
    [960, 540],
  ] as const) {
    await resize(page, width, height);
    const at = await hudBoxes(page);
    const where = `at ${width}x${height}`;
    expect(at.chat.bottom - at.chat.top, `the chat is open to its height ${where}`).toBeGreaterThan(
      0.3 * height,
    );
    expect(overlap(at.map, at.chat), `the chat is clear of the map ${where}`).toBe(false);
  }

  // Below that there is not room for both: the map goes and the room takes the corner.
  for (const [width, height] of [
    [844, 390],
    [1280, 500],
  ] as const) {
    await resize(page, width, height);
    const where = `at ${width}x${height}`;
    await expect(page.locator('.minimap'), `the map goes ${where}`).toBeHidden();
    const left = await page.evaluate(() => ({
      title: document.querySelector('.hud-room-title')!.getBoundingClientRect().left,
      chat: document.querySelector('.chat')!.getBoundingClientRect().left,
    }));
    expect(left.title, `the room takes the corner ${where}`).toBeCloseTo(left.chat, 0);
  }
  await page.context().close();
});

test('station labels show in the strip between the map and the room name, where nothing is', async ({
  browser,
}) => {
  const page = await enterWorld(browser, { name: 'Strip Reader', online: false });
  await resize(page, 1280, 720);
  const products = page.locator('.lore-label', { hasText: 'Products' });
  const label = () =>
    products.evaluate((node) => {
      const { left, top, right, bottom } = node.getBoundingClientRect();
      return { left, top, right, bottom, shown: Number((node as HTMLElement).style.opacity) > 0 };
    });
  // Pixels to the radian at the middle of the screen: the camera's vertical field of view is 72
  // degrees, over the window's 720 px.
  const focal = 360 / Math.tan((36 * Math.PI) / 180);

  /** Turn the view until the label's middle is near (x, y) on the screen. */
  async function steerTo(x: number, y: number): Promise<void> {
    for (let i = 0; i < 8; i++) {
      const at = await label();
      const cx = (at.left + at.right) / 2;
      const cy = (at.top + at.bottom) / 2;
      if (Math.abs(x - cx) < 15 && Math.abs(y - cy) < 15) return;
      const { look } = await world(page);
      // The angle a point on the screen is from the middle of it is its offset's arctangent.
      // Turning left carries what is in view to the right; looking down carries it up.
      await turnTo(
        page,
        look.yaw + Math.atan((x - 640) / focal) - Math.atan((cx - 640) / focal),
        look.pitch + Math.atan((y - 360) / focal) - Math.atan((cy - 360) / focal),
      );
      await waitForFrames(page, 2);
    }
    // A label that gives way stops where it was, so one hidden in the strip never gets there.
    const last = await label();
    throw new Error(
      `the label did not come to ${Math.round(x)}, ${Math.round(y)}, and is ${last.shown ? 'showing' : 'hidden'}`,
    );
  }

  // The pass's labels show from the spawn once the game has drawn a few frames.
  await expect.poll(async () => (await label()).shown, { message: 'Products shows' }).toBe(true);

  // Just right of the map and under the room's name: the corner's empty strip.
  const at = await hudBoxes(page);
  const x = at.map.right + 90;
  const y = Math.max(at.room.bottom, at.map.top) + 80;
  await steerTo(x, y);
  await waitForFrames(page, 3);
  const inStrip = await label();
  expect(inStrip.left, 'the label is right of the map').toBeGreaterThan(at.map.right);
  expect(inStrip.top, 'the label is under the room').toBeGreaterThan(at.room.bottom);
  expect(inStrip.shown, 'a label shows where neither the map nor the room is').toBe(true);

  // The same label over the map gives way to it, and to nothing else: with the map's slot out of
  // the page the label shows in the map's box, and with it back it is hidden.
  const slotOut = await page.addStyleTag({ content: '.hud-map { display: none !important; }' });
  await waitForFrames(page, 3);
  await steerTo((at.map.left + at.map.right) / 2, (at.map.top + at.map.bottom) / 2);
  await waitForFrames(page, 3);
  const overMap = await label();
  expect(overMap.shown, 'a label shows in the map box when the map is not there').toBe(true);
  expect((overMap.left + overMap.right) / 2, 'the label is in the map box').toBeGreaterThan(
    at.map.left,
  );
  expect((overMap.left + overMap.right) / 2, 'the label is in the map box').toBeLessThan(
    at.map.right,
  );
  expect((overMap.top + overMap.bottom) / 2, 'the label is in the map box').toBeGreaterThan(
    at.map.top,
  );
  expect((overMap.top + overMap.bottom) / 2, 'the label is in the map box').toBeLessThan(
    at.map.bottom,
  );
  await slotOut.evaluate((node) => (node as HTMLElement).remove());
  await waitForFrames(page, 3);
  expect((await label()).shown, 'a label over the map gives way to it').toBe(false);
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
