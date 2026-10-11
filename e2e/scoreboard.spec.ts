import type { Page } from '@playwright/test';
import {
  enterWorld,
  expect,
  expectWorld,
  hitUntil,
  startRoomServer,
  test,
  throwKnife,
  waitForFrames,
  world,
} from './helpers.ts';

/** The scoreboard, held up with Tab. */
const board = (page: Page) => page.getByRole('region', { name: 'Scoreboard' });

interface Line {
  name: string | null;
  kills: string | null;
  deaths: string | null;
  assists: string | null;
  you: boolean;
  /** The color of the name, as the page sets it. */
  color: string;
}

/** The lines of the scoreboard as drawn, top to bottom. */
function lines(page: Page): Promise<Line[]> {
  return page.locator('.scoreboard-row').evaluateAll((rows) =>
    rows.map((row) => {
      const text = (selector: string) => row.querySelector(selector)?.textContent ?? null;
      const name = row.querySelector<HTMLElement>('.scoreboard-cook')!;
      return {
        name: name.textContent,
        kills: text('.is-kills'),
        deaths: text('.is-deaths'),
        assists: text('.is-assists'),
        you: row.querySelector('.scoreboard-you')?.textContent === 'you',
        color: name.style.getPropertyValue('--player-color'),
      };
    }),
  );
}

/** Hold Tab on a page, and let go again at the end of `check`. */
async function holdingTab(page: Page, check: () => Promise<void>): Promise<void> {
  await page.keyboard.down('Tab');
  try {
    await check();
  } finally {
    await page.keyboard.up('Tab');
  }
}

test('Tab shows who has knocked out whom, on every screen, for as long as it is held', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const room = 'e2e-scores';
  const server = await startRoomServer();
  try {
    const alice = await enterWorld(browser, { name: 'Alice', room });
    const bob = await enterWorld(browser, { name: 'Bob', room });
    const cara = await enterWorld(browser, { name: 'Cara', room });
    const pages = { Alice: alice, Bob: bob, Cara: cara };
    for (const page of Object.values(pages)) {
      await expectWorld(page, (w) => w.playerCount === 3, 'everyone sees everyone');
    }

    // Nothing up until it is asked for, and everyone at nothing.
    for (const page of Object.values(pages)) {
      await expect(board(page)).toBeHidden();
      expect((await world(page)).scoreboard.shown).toBe(false);
    }

    // Cara hits Bob once, and Alice takes the other two: a knockout for Alice, an assist for Cara,
    // and a death for Bob.
    await hitUntil(server, room, cara, bob, 2);
    await hitUntil(server, room, alice, bob, 0);
    await expectWorld(bob, (w) => w.knockedOut, 'Bob is knocked out');
    for (const page of Object.values(pages)) {
      await expectWorld(
        page,
        (w) => w.scoreboard.rows.some((r) => r.name === 'Alice' && r.kills === 1),
        'the knockout reaches the scoreboard',
      );
    }

    // The room server counts the same.
    const counted = Object.fromEntries(
      ((await server.room(room))?.players ?? []).map((p) => [p.name, p.score]),
    );
    expect(counted).toEqual({
      Alice: { kills: 1, deaths: 0, assists: 0 },
      Bob: { kills: 0, deaths: 1, assists: 0 },
      Cara: { kills: 0, deaths: 0, assists: 1 },
    });

    // Held, it lists them best first: most kills, then fewest deaths. Each page marks its own cook.
    for (const [me, page] of Object.entries(pages)) {
      await holdingTab(page, async () => {
        await expect(board(page)).toBeVisible();
        await expect(board(page).getByRole('heading', { name: 'Scoreboard' })).toBeVisible();
        const colors = Object.fromEntries(
          (await world(page)).remotePlayers.map((p) => [p.name, p.color]),
        );
        const shown = await lines(page);
        expect(
          shown.map(({ name, kills, deaths, assists }) => [name, kills, deaths, assists]),
        ).toEqual([
          ['Alice', '1', '0', '0'],
          ['Cara', '0', '0', '1'],
          ['Bob', '0', '1', '0'],
        ]);
        expect(shown.filter((line) => line.you).map((line) => line.name)).toEqual([me]);
        // Every other name is in its cook's color, as their name tag and the chat have it.
        for (const line of shown.filter((line) => !line.you)) {
          expect(line.color, `${line.name}'s color`).toBe(colors[line.name!]);
        }
        // For a reader too: a table with its columns named.
        await expect(board(page).getByRole('columnheader', { name: 'Kills' })).toBeVisible();
        await expect(board(page).getByRole('columnheader', { name: 'Deaths' })).toBeVisible();
        await expect(board(page).getByRole('columnheader', { name: 'Assists' })).toBeVisible();
        await expect(board(page).getByRole('row', { name: /Alice.* 1 0 0/ })).toBeVisible();
        expect((await world(page)).scoreboard.shown).toBe(true);
      });
      // Let go, and it goes.
      await expect(board(page)).toBeHidden();
      expect((await world(page)).scoreboard.shown).toBe(false);
    }
    for (const page of Object.values(pages)) await page.context().close();
  } finally {
    await server.close();
  }
});

test('scores last as long as the cook is in the room: leaving takes them, coming back starts again', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const room = 'e2e-scores-leave';
  const server = await startRoomServer();
  try {
    const alice = await enterWorld(browser, { name: 'Alice', room });
    const bob = await enterWorld(browser, { name: 'Bob', room });
    await hitUntil(server, room, alice, bob, 0);
    await expectWorld(bob, (w) => w.scoreboard.rows.some((r) => r.deaths === 1), 'Bob has died');
    await expectWorld(
      bob,
      (w) => w.scoreboard.rows.some((r) => r.name === 'Alice' && r.kills === 1),
      "Alice's knockout shows",
    );

    // Alice goes, and her score with her.
    await alice.context().close();
    await expectWorld(bob, (w) => w.playerCount === 1, 'Alice has left');
    await holdingTab(bob, async () => {
      await expect(board(bob)).toBeVisible();
      expect((await lines(bob)).map((line) => [line.name, line.deaths])).toEqual([['Bob', '1']]);
    });

    // Back under the same name, a new cook: from nothing, while Bob keeps his death. The welcome
    // brought everyone's score, Bob's included, and she sees them as the room has them.
    const again = await enterWorld(browser, { name: 'Alice', room });
    await expectWorld(again, (w) => w.playerCount === 2, 'Alice sees Bob');
    for (const page of [again, bob]) {
      await expectWorld(page, (w) => w.playerCount === 2, 'both see both');
      await holdingTab(page, async () => {
        await expect(board(page)).toBeVisible();
        const shown = await lines(page);
        expect(
          shown.map(({ name, kills, deaths, assists }) => [name, kills, deaths, assists]),
        ).toEqual([
          ['Alice', '0', '0', '0'],
          ['Bob', '0', '1', '0'],
        ]);
      });
    }
    await again.context().close();
    await bob.context().close();
  } finally {
    await server.close();
  }
});

test('Tab shows just you when playing solo', async ({ browser }) => {
  const page = await enterWorld(browser, { name: 'Lonesome', online: false });
  await holdingTab(page, async () => {
    await expect(board(page)).toBeVisible();
    expect(await lines(page)).toEqual([
      expect.objectContaining({
        name: 'Lonesome',
        kills: '0',
        deaths: '0',
        assists: '0',
        you: true,
      }),
    ]);
  });
  await expect(board(page)).toBeHidden();
  await page.context().close();
});

test('Tab keeps the browser from moving focus off the game, held or tapped, shifted or not', async ({
  browser,
}) => {
  const page = await enterWorld(browser, { name: 'Focused', online: false });
  // Something Tab would otherwise land on.
  await page.evaluate(() => {
    const probe = document.createElement('button');
    probe.id = 'probe';
    probe.textContent = 'probe';
    probe.style.cssText = 'position:fixed;left:8px;top:8px;width:40px;height:20px;z-index:1';
    document.body.append(probe);
  });
  const focused = () =>
    page.evaluate(() => document.activeElement?.id || document.activeElement?.tagName);
  const before = await focused();
  expect(before).not.toBe('probe');

  await page.keyboard.press('Tab');
  expect(await focused()).toBe(before);
  await page.keyboard.press('Shift+Tab');
  expect(await focused()).toBe(before);
  // Held, the key repeats; every repeat would move it.
  await page.keyboard.down('Tab');
  for (let i = 0; i < 5; i++) await page.keyboard.down('Tab');
  await expect(board(page)).toBeVisible();
  expect(await focused()).toBe(before);
  await page.keyboard.up('Tab');
  await expect(board(page)).toBeHidden();
  expect(await focused()).toBe(before);

  // Not a reason to stop the menu from having it, though: in the menu Tab goes round its controls,
  // and shows no scoreboard.
  await page.keyboard.press('Escape');
  await expectWorld(page, (w) => w.mode === 'paused', 'the menu opens');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  expect(await focused()).not.toBe(before);
  await expect(board(page)).toBeHidden();
  await page.context().close();
});

test('Tab works with the pointer locked as without it, and lets go when the menu opens', async ({
  browser,
}) => {
  const page = await enterWorld(browser, { name: 'Locked', online: false });
  // Headless Chromium never grants the lock, so stand in for the browser: lock on request, and
  // say so the way it does.
  await page.evaluate(() => {
    let locked: Element | null = null;
    Object.defineProperty(Document.prototype, 'pointerLockElement', { get: () => locked });
    const change = (to: Element | null) => {
      locked = to;
      document.dispatchEvent(new Event('pointerlockchange'));
    };
    Element.prototype.requestPointerLock = function (this: Element) {
      change(this);
      return Promise.resolve();
    };
    Document.prototype.exitPointerLock = () => change(null);
  });
  // The click into the world takes the lock.
  await page.mouse.click(480, 270);
  await expect.poll(() => page.evaluate(() => document.pointerLockElement !== null)).toBe(true);
  await holdingTab(page, async () => {
    await expect(board(page)).toBeVisible();
  });
  await expect(board(page)).toBeHidden();

  // Held while the menu opens (Esc, which under a real lock the browser takes, so the page hears
  // the lock go): the scoreboard goes with it, however long Tab stays down.
  await page.keyboard.down('Tab');
  await expect(board(page)).toBeVisible();
  await page.evaluate(() => document.exitPointerLock());
  await expectWorld(page, (w) => w.mode === 'paused', 'the menu opens');
  await expect(board(page)).toBeHidden();
  await page.keyboard.up('Tab');
  await page.context().close();
});

test('Tab shows nothing while typing in the chat, and nothing is held after the chat closes', async ({
  browser,
}) => {
  const page = await enterWorld(browser, { name: 'Typist', online: false });
  await page.keyboard.press('Enter');
  await expectWorld(page, (w) => w.mode === 'chat', 'the chat opens');
  await page.keyboard.down('Tab');
  await waitForFrames(page, 2);
  await expect(board(page)).toBeHidden();
  await page.keyboard.up('Tab');
  await page.keyboard.press('Escape');
  await expectWorld(page, (w) => w.mode === 'playing', 'back to playing');
  await expect(board(page)).toBeHidden();
  // And a throw in between does not bring it up either.
  await throwKnife(page);
  await expect(board(page)).toBeHidden();
  await page.context().close();
});
