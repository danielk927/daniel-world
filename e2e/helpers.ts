import { expect, type Browser, type Page } from '@playwright/test';
import type { WorldDebugState } from '../apps/client/src/debug.ts';
import { startServer, type WorldServer } from '../apps/server/src/server.ts';
import { E2E_SERVER_PORT } from './ports.ts';

export type { WorldDebugState };

/**
 * Run the real room server inside the test process so tests can stop and restart it. Chef Skinner
 * is in the lobby, as in production.
 */
export function startRoomServer(): Promise<WorldServer> {
  return startServer({ port: E2E_SERVER_PORT, host: '127.0.0.1', chef: true });
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
      look: w.look,
      view: w.view,
      armed: w.armed,
      inspecting: w.inspecting,
      inspectTime: w.inspectTime,
      punching: w.punching,
      computer: w.computer,
      knockedOut: w.knockedOut,
      knife: w.knife,
      knives: w.knives,
      cooler: w.cooler,
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

/**
 * Open the site in a fresh browser context and walk through the landing screen like a visitor.
 * `path` opens another address first, such as an invite link; `prepare` runs before the page loads.
 */
export async function enterWorld(
  browser: Browser,
  options: {
    name: string;
    room?: string;
    online?: boolean;
    path?: string;
    prepare?: (page: Page) => Promise<void>;
  },
): Promise<Page> {
  // A modest viewport keeps several software-rendered pages responsive on one machine.
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await context.newPage();
  await options.prepare?.(page);
  await page.goto(options.path ?? '/');
  // Pages already in the world keep rendering in software on the same CPU, so a third page can take
  // a while to build the kitchen and compile its shaders.
  await expect(page.getByRole('button', { name: 'Enter the kitchen' })).toBeVisible({
    timeout: 60_000,
  });
  await page.getByLabel('Your name').fill(options.name);
  if (options.room) {
    // The party's code field opens from the row along the bottom, unless an invite opened it.
    const party = page.getByRole('button', { name: 'Private party' });
    if ((await party.getAttribute('aria-expanded')) !== 'true') await party.click();
    await page.getByLabel('Private party').fill(options.room);
  }
  await page.getByRole('button', { name: 'Enter the kitchen' }).click();
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

/** Turn the view to a yaw by dragging the mouse, the way a visitor without pointer lock looks around. */
export async function turnTo(page: Page, yaw: number, pitch = 0): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const { look } = await world(page);
    const dYaw = look.yaw - yaw;
    const dPitch = pitch - look.pitch;
    if (Math.abs(dYaw) < 0.02 && Math.abs(dPitch) < 0.02) return;
    // Out and back, so even a tiny correction is a drag and never a click (which would throw).
    await page.mouse.move(480, 270);
    await page.mouse.down();
    await page.mouse.move(480, 210, { steps: 2 });
    const clamp = (v: number) => Math.max(-150, Math.min(150, v * 250));
    await page.mouse.move(480 + clamp(dYaw), 270 - clamp(dPitch), { steps: 3 });
    await page.mouse.up();
  }
  throw new Error(`could not turn to ${yaw}`);
}
