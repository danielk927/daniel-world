import type { Page } from '@playwright/test';
import { COOLER, COOLER_HITS_TO_OPEN, ROOM_HALF_X } from '@world/shared';
import { ENTRANCE_LINES } from '../apps/server/src/chef.ts';
import {
  enterWorld,
  expect,
  expectWorld,
  punchUntil,
  reenterWorld,
  type RoomServer,
  type RoomView,
  startRoomServer,
  test,
  waitForFrames,
  walkToWalkIn,
  world,
} from './helpers.ts';

let server: RoomServer;

test.beforeAll(async () => {
  server = await startRoomServer();
});

test.afterAll(async () => {
  await server.close();
});

/** Pacing until he throws can take up to a minute and a half, more than a body's usual time. */
const PACING_MS = 180_000;

type Cook = RoomView['players'][number];

/** Who the room server has in the lobby. */
const inLobby = async (): Promise<readonly Cook[]> => (await server.room('lobby'))?.players ?? [];

/** Walk to the walk-in, knife away, and punch until its door bursts: he comes out. */
async function breakTheDoorDown(page: Page): Promise<void> {
  await walkToWalkIn(page);
  await page.keyboard.press('KeyQ');
  await expectWorld(page, (w) => !w.armed, 'the knife is put away');
  await punchUntil(page, COOLER_HITS_TO_OPEN);
}

/** Chef Skinner as the room server first has him, once he is out of the lobby's walk-in. */
async function firstSight(): Promise<Cook> {
  let chef: Cook | undefined;
  await expect
    .poll(
      async () => {
        chef = (await inLobby()).find((cook) => cook.resident);
        return chef !== undefined;
      },
      { message: 'Chef Skinner comes out of the walk-in', timeout: 10_000, intervals: [50] },
    )
    .toBe(true);
  return chef!;
}

test('Chef Skinner is locked in the walk-in until its door bursts, then comes out into the kitchen', async ({
  browser,
}) => {
  const boxer = await enterWorld(browser, { name: 'Boxer' });
  // Nobody else in the lobby, on the server or on the screen: no name in the list, no dot on the map.
  expect((await inLobby()).map((cook) => cook.name)).toEqual(['Boxer']);
  await waitForFrames(boxer);
  const alone = await world(boxer);
  expect(alone.remotePlayers).toEqual([]);
  expect(alone.playerCount).toBe(1);

  // Nine hits in, the door still holds and still nobody is behind it, as far as anyone can tell.
  await walkToWalkIn(boxer);
  await boxer.keyboard.press('KeyQ');
  await expectWorld(boxer, (w) => !w.armed, 'the boxer puts the knife away');
  for (let hits = 1; hits < COOLER_HITS_TO_OPEN; hits++) await punchUntil(boxer, hits);
  expect((await inLobby()).map((cook) => cook.name)).toEqual(['Boxer']);
  await waitForFrames(boxer);
  expect((await world(boxer)).remotePlayers).toEqual([]);

  // The tenth bursts it, and a moment later he is there, at the back of the cold room.
  await punchUntil(boxer, COOLER_HITS_TO_OPEN);
  const chef = await firstSight();
  expect(chef.name).toBe('Chef Skinner');
  expect(chef.x).toBeGreaterThan(COOLER.minX + 1);
  await expectWorld(
    boxer,
    (w) => w.cooler.open && w.remotePlayers.some((p) => p.name === 'Chef Skinner'),
    'the boxer sees the door open and Chef Skinner in the room',
  );
  // Shouting about it...
  const log = boxer.getByRole('list', { name: 'Chat history' });
  await expect(log).toContainText('Chef Skinner is out of the walk-in');
  const said = (await log.textContent()) ?? '';
  expect(
    ENTRANCE_LINES.some((line) => said.includes(line)),
    said,
  ).toBe(true);
  // ...and out through the doorway, into the kitchen.
  await expectWorld(
    boxer,
    (w) => {
      const now = w.remotePlayers.find((p) => p.name === 'Chef Skinner');
      return now !== undefined && now.x < ROOM_HALF_X - 0.5;
    },
    'he comes out into the kitchen',
  );
  await boxer.context().close();
});

test('a visitor who switches him off is left alone while he throws at others', async ({
  browser,
}) => {
  test.setTimeout(PACING_MS);
  /** What the room server knows about this page's visitor's choice. */
  const choice = async (page: Page) => {
    const { selfId } = await world(page);
    return (await inLobby()).find((cook) => cook.id === selfId)?.prefs.chef;
  };

  // Off in the settings menu, with the keyboard; the server hears at once.
  const reader = await enterWorld(browser, { name: 'Reader' });
  await reader.keyboard.press('Escape');
  // The menu opens on the Party tab; the arrow keys go down the list of tabs to Settings.
  await reader.getByRole('tab', { name: 'Party' }).focus();
  await reader.keyboard.press('ArrowDown');
  await reader.keyboard.press('ArrowDown');
  const settings = reader.getByRole('tab', { name: 'Settings' });
  await expect(settings).toBeFocused();
  await expect(settings).toHaveAttribute('aria-selected', 'true');
  const toggle = reader.getByRole('switch', { name: 'Chef Skinner throws knives at me' });
  await expect(toggle).toHaveAttribute('aria-checked', 'true');
  await toggle.focus();
  await reader.keyboard.press('Space');
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await expect.poll(() => choice(reader)).toBe(false);

  // Still off after a reload: saved, and in the hello of the new connection.
  await reenterWorld(reader, { name: 'Reader' });
  expect(await choice(reader)).toBe(false);

  // A second cook lets him out of the walk-in.
  const pacer = await enterWorld(browser, { name: 'Pacer' });
  await breakTheDoorDown(pacer);
  await firstSight();
  // The server writes down whom he winds up to throw at, every tick, so never is never; he leaves
  // everyone alone for a few seconds after he comes out, so nothing is missed meanwhile.
  expect(await server.watchChef('lobby')).toBe(true);

  // Both pace; he throws at the one who has not turned him off, never the other.
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
  const [readerId, pacerId] = [(await world(reader)).selfId, (await world(pacer)).selfId];
  const picked = await server.chefTargets('lobby');
  expect(picked?.watching, 'the same Chef Skinner throughout').toBe(true);
  expect(picked?.targets, 'he picks the pacer').toContain(pacerId);
  expect(picked?.targets, 'and never the reader').not.toContain(readerId);
  for (const page of [reader, pacer]) await page.context().close();
});
