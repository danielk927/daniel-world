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
      frames: w.frames,
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
 * Wait until the game has run `count` more frames, each reading the input, stepping the simulation
 * and updating the hover prompt, so whatever the test just did has been seen however slowly the page
 * runs. Use it before a check that something did not happen, instead of a fixed wait: on a starved
 * page a fixed wait can pass before the game has looked.
 */
export async function waitForFrames(page: Page, count = 2): Promise<void> {
  await page.evaluate(async (count) => {
    const target = window.__world!.frames + count;
    while (window.__world!.frames < target) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }, count);
}

/**
 * Open the site in a fresh browser context and walk through the landing screen like a visitor.
 * `path` opens another address first, such as an invite link.
 */
export async function enterWorld(
  browser: Browser,
  options: { name: string; room?: string; online?: boolean; path?: string },
): Promise<Page> {
  // A modest viewport keeps several software-rendered pages responsive on one machine.
  const context = await browser.newContext({ viewport: { width: 960, height: 540 } });
  const page = await context.newPage();
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

/**
 * Wait until the local player has stopped moving, and return that state: two samples apart in time
 * that agree, with the game's frames having moved on between them, since a page that ran no frame
 * in between would look still in the middle of a slide.
 */
export async function waitUntilStill(page: Page): Promise<WorldDebugState> {
  let previous = await world(page);
  for (let i = 0; i < 50; i++) {
    await page.waitForTimeout(200);
    await waitForFrames(page, 2);
    const current = await world(page);
    const p = previous.player;
    const c = current.player;
    if (p.x === c.x && p.y === c.y && p.z === c.z && c.grounded) return current;
    previous = current;
  }
  throw new Error('player never came to rest');
}

/**
 * Without pointer lock the game picks under the cursor: move it over `points` in turn, as a visitor
 * sweeps the mouse over the view, until the prompt says `prompt`. The prompt follows the cursor once
 * a frame, so each point waits for the game to have run a frame with the cursor there before reading
 * it: the move is handled by the time the next frame's callbacks run, whether Chrome has dispatched
 * it already or holds it to the start of that frame, as it does with mouse moves. Returns the point
 * that found it, or null.
 */
export async function findWithCursor(
  page: Page,
  points: Iterable<{ readonly x: number; readonly y: number }>,
  prompt: string,
): Promise<{ x: number; y: number } | null> {
  for (const { x, y } of points) {
    await page.mouse.move(x, y);
    await waitForFrames(page, 1);
    const shown = await page.locator('.prompt-sentence').textContent();
    if (shown === prompt) return { x, y };
  }
  return null;
}

/** Points down a column of the screen, from `from` to before `to`, every `step` pixels. */
export function* column(x: number, from: number, to: number, step: number) {
  for (let y = from; y < to; y += step) yield { x, y };
}

/** Points over a box of the screen, row by row, every `step` pixels each way. */
export function* grid(
  x: readonly [number, number],
  y: readonly [number, number],
  step: { readonly x: number; readonly y: number },
) {
  for (let py = y[0]; py < y[1]; py += step.y) {
    for (let px = x[0]; px < x[1]; px += step.x) yield { x: px, y: py };
  }
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
