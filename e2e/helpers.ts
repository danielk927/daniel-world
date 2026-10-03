import { expect, type Browser, type Page } from '@playwright/test';
import type { WorldDebugState } from '../apps/client/src/debug.ts';
import { startServer, type WorldServer } from '../apps/server/src/server.ts';
import { E2E_SERVER_PORT } from './ports.ts';

export type { WorldDebugState };

/** Run the real room server inside the test process so tests can stop and restart it. */
export function startRoomServer(): Promise<WorldServer> {
  return startServer({ port: E2E_SERVER_PORT, host: '127.0.0.1' });
}

/** Read the page's debug state. */
export function world(page: Page): Promise<WorldDebugState> {
  return page.evaluate(() => {
    const w = window.__world!;
    return {
      ready: w.ready,
      mode: w.mode,
      connection: w.connection,
      room: w.room,
      selfId: w.selfId,
      player: w.player,
      remotePlayers: w.remotePlayers,
      playerCount: w.playerCount,
      prediction: w.prediction,
      renderer: w.renderer,
    };
  });
}

/** Poll the debug state until `check` passes. */
export async function expectWorld(
  page: Page,
  check: (state: WorldDebugState) => boolean,
  message: string,
  timeout = 15_000,
): Promise<WorldDebugState> {
  let last: WorldDebugState | null = null;
  await expect
    .poll(
      async () => {
        last = await world(page);
        return check(last);
      },
      { message, timeout },
    )
    .toBe(true);
  return last!;
}

/** Open the site in a fresh browser context and walk through the landing screen like a visitor. */
export async function enterWorld(
  browser: Browser,
  options: { name: string; room?: string; online?: boolean },
): Promise<Page> {
  // A modest viewport keeps several software-rendered pages responsive on one machine.
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await context.newPage();
  await page.goto('/');
  // Pages already in the world keep rendering in software on the same CPU, so a third page can take
  // a while to build the kitchen and compile its shaders.
  await expect(page.getByRole('button', { name: 'Enter world' })).toBeVisible({ timeout: 60_000 });
  await page.getByLabel('Your name').fill(options.name);
  if (options.room) await page.getByLabel('Room code').fill(options.room);
  await page.getByRole('button', { name: 'Enter world' }).click();
  const online = options.online ?? true;
  await expectWorld(
    page,
    (w) => w.mode === 'playing' && (!online || w.connection === 'online'),
    `${options.name} should be ${online ? 'online and ' : ''}playing`,
    30_000,
  );
  return page;
}

/** Wait until the local player has stopped moving, and return that state. */
export async function waitUntilStill(page: Page): Promise<WorldDebugState> {
  let previous = await world(page);
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(200);
    const current = await world(page);
    const p = previous.player;
    const c = current.player;
    if (p.x === c.x && p.y === c.y && p.z === c.z && c.grounded) return current;
    previous = current;
  }
  throw new Error('player never came to rest');
}

/**
 * Hold a key until the player's position satisfies `arrived`, like a person walking to a spot.
 * Robust to frame rate, unlike holding for a fixed time.
 */
export async function walkUntil(
  page: Page,
  key: string,
  arrived: (player: WorldDebugState['player']) => boolean,
  timeout = 15_000,
): Promise<void> {
  await page.keyboard.down(key);
  try {
    await expect
      .poll(async () => arrived((await world(page)).player), { timeout, intervals: [50] })
      .toBe(true);
  } finally {
    await page.keyboard.up(key);
  }
}
