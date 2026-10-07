import { expect, test, type Page } from '@playwright/test';
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

test('a visitor who switches him off is left alone while he throws at others', async ({
  browser,
}) => {
  test.setTimeout(240_000);
  /** What the room server knows about this page's visitor's choice. */
  const choice = async (page: Page) => {
    const { selfId } = await world(page);
    return selfId === null ? undefined : server.rooms.get('lobby')?.players.get(selfId)?.prefs.chef;
  };

  // Off in the settings menu, with the keyboard; the server hears at once.
  const reader = await enterWorld(browser, { name: 'Reader' });
  await reader.keyboard.press('Escape');
  // The menu opens on the Party tab.
  await reader.getByRole('tab', { name: 'Settings' }).click();
  const toggle = reader.getByRole('switch', { name: 'Chef Skinner throws knives at me' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.focus();
  await reader.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => choice(reader)).toBe(false);

  // Still off after a reload: saved, and in the hello of the new connection.
  await reader.reload();
  await reader.getByRole('button', { name: 'Enter world' }).click({ timeout: 60_000 });
  await expectWorld(
    reader,
    (w) => w.mode === 'playing' && w.connection === 'online',
    'Reader is back',
    30_000,
  );
  expect(await choice(reader)).toBe(false);

  // Two cooks pace the aisle; he throws at the one who has not turned him off, never the other.
  const pacer = await enterWorld(browser, { name: 'Pacer' });
  // A knife of his landing anywhere, or in the pacer, shows he is throwing.
  const seen = { knives: 0, pacerDown: false };
  for (let i = 0; i < 150 && !seen.pacerDown && seen.knives < 3; i++) {
    const key = i % 2 === 0 ? 'KeyA' : 'KeyD';
    await Promise.all([reader.keyboard.down(key), pacer.keyboard.down(key)]);
    await reader.waitForTimeout(600);
    await Promise.all([reader.keyboard.up(key), pacer.keyboard.up(key)]);
    const [r, p] = await Promise.all([world(reader), world(pacer)]);
    expect(r.knockedOut, 'Reader is never knocked out').toBe(false);
    seen.pacerDown ||= p.knockedOut;
    seen.knives = Math.max(seen.knives, r.knives.stuck + r.knives.flying);
  }
  expect(seen.pacerDown || seen.knives >= 3, 'he has been throwing').toBe(true);
  for (const page of [reader, pacer]) await page.context().close();
});
