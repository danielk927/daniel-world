import type { Page } from '@playwright/test';
import { COOLER, COOLER_HITS_TO_OPEN, ROOM_HALF_X } from '@world/shared';
import {
  enterWorld,
  expect,
  expectWorld,
  startRoomServer,
  test,
  turnTo,
  waitForFrames,
  waitUntilStill,
  walkUntil,
  world,
} from './helpers.ts';

const EAST = -Math.PI / 2;
const NORTH = 0;

/**
 * From the spawn by the dining room doors, the way a visitor finds the walk-in: east along the
 * aisle past the end of the pass, north up the east aisle behind the garde manger, and turn to face
 * the steel door in the east wall.
 */
async function walkToWalkIn(page: Page): Promise<void> {
  await turnTo(page, EAST);
  await walkUntil(page, 'KeyW', (p) => p.x >= 6);
  await turnTo(page, NORTH);
  await walkUntil(page, 'KeyW', (p) => p.z <= -3);
  await turnTo(page, EAST);
  await walkUntil(page, 'KeyW', (p) => p.x >= ROOM_HALF_X - 1);
  await waitUntilStill(page);
}

/** Punch the door with the bare hand until it has taken `hits`. */
async function punchUntil(page: Page, hits: number): Promise<void> {
  await expect
    .poll(
      async () => {
        const w = await world(page);
        if (w.cooler.hits >= hits) return true;
        // A click mid-jab does nothing yet; the next one lands once the fist is back.
        if (!w.punching) await page.mouse.click(480, 270);
        return false;
      },
      { message: `the door has taken ${hits} hits`, timeout: 15_000, intervals: [100] },
    )
    .toBe(true);
}

test("ten punches burst the walk-in's door, the puncher walks in, and everyone sees it open", async ({
  browser,
}) => {
  const server = await startRoomServer();
  try {
    const boxer = await enterWorld(browser, { name: 'Boxer', room: 'e2e-cooler' });
    const watcher = await enterWorld(browser, { name: 'Watcher', room: 'e2e-cooler' });
    await expectWorld(boxer, (w) => w.playerCount === 2, 'the boxer sees the watcher');
    expect((await world(boxer)).cooler).toEqual({ hits: 0, open: false, angle: 0 });

    await walkToWalkIn(boxer);
    // The shut door is a wall: walking on into it for half a second of the game's clock (a frame
    // is at least a display refresh) gets the boxer no further.
    await walkUntil(boxer, 'KeyW', (p) => p.x >= ROOM_HALF_X - 0.45);
    await boxer.keyboard.down('KeyW');
    await waitForFrames(boxer, 30);
    await boxer.keyboard.up('KeyW');
    expect((await world(boxer)).player.x).toBeLessThan(ROOM_HALF_X - 0.39);

    await boxer.keyboard.press('KeyQ');
    await expectWorld(boxer, (w) => !w.armed, 'the boxer puts the knife away');
    for (let hits = 1; hits < COOLER_HITS_TO_OPEN; hits++) await punchUntil(boxer, hits);
    expect((await world(boxer)).cooler.open).toBe(false);
    await expectWorld(
      watcher,
      (w) => w.cooler.hits === COOLER_HITS_TO_OPEN - 1,
      'the watcher hears every hit',
    );

    await punchUntil(boxer, COOLER_HITS_TO_OPEN);
    await expectWorld(
      boxer,
      (w) => w.cooler.open && w.cooler.angle > Math.PI / 2 - 0.01,
      'the door bursts open and swings in against the wall',
    );

    // In through the doorway, to the back of the cold room.
    await walkUntil(boxer, 'KeyW', (p) => p.x > COOLER.minX + 1.5);
    const inside = await waitUntilStill(boxer);
    expect(inside.player.x).toBeGreaterThan(COOLER.minX + 1.5);
    expect(inside.player.x).toBeLessThanOrEqual(COOLER.maxX - 0.4 + 1e-6);
    // The server let the boxer through where their own screen did: no correction worth the name.
    expect(inside.prediction.maxCorrection).toBeLessThan(0.3);

    // The other cook saw the door give and sees the boxer inside.
    await expectWorld(
      watcher,
      (w) =>
        w.cooler.open &&
        w.cooler.angle > Math.PI / 2 - 0.01 &&
        (w.remotePlayers[0]?.x ?? 0) > COOLER.minX + 1,
      'the watcher sees the door open and the boxer in the cooler',
    );

    // Late arrivals (the welcome) are covered by the server's tests: a third software-rendered page
    // is more than a loaded machine can build within the test's time.
    for (const page of [boxer, watcher]) await page.context().close();
  } finally {
    await server.close();
  }
});

test('the walk-in breaks open playing solo too', async ({ browser }) => {
  const page = await enterWorld(browser, { name: 'Solo', online: false });
  await walkToWalkIn(page);
  await page.keyboard.press('KeyQ');
  await expectWorld(page, (w) => !w.armed, 'the knife is put away');
  await punchUntil(page, COOLER_HITS_TO_OPEN);
  await expectWorld(page, (w) => w.cooler.open && w.cooler.angle > 1.5, 'the door swings open');
  await walkUntil(page, 'KeyW', (p) => p.x > COOLER.minX + 1);
  await page.context().close();
});
