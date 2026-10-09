/**
 * The kitchen from fixed viewpoints, for judging a visual change: the same frames before and after.
 *
 *   node scripts/viewpoints.ts [--out docs/graphics-upgrade/after] [--dpr 1] [--format jpg|png]
 *                              [--only suite,pass]
 *                              [--time 20:00] [--quality high]
 *
 * Starts the Vite dev client if it is not up (WORLD_CLIENT_PORT moves it off :5173); no room server
 * is needed. Each view loads the page with `?view=` (see apps/client/src/game/photoView.ts), which
 * holds the camera there behind the landing, hides the interface, and shoots the frame on the real
 * GPU, with the quality governor held at its best level. It prints how long each load took to the
 * "Enter the kitchen" button.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';
import { EYE_HEIGHT } from '@world/shared';

const root = resolve(import.meta.dirname, '..');
const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'docs/graphics-upgrade/after' },
    dpr: { type: 'string', default: '1' },
    format: { type: 'string', default: 'jpg' },
    only: { type: 'string' },
    time: { type: 'string', default: '20:00' },
    quality: { type: 'string', default: 'high' },
  },
});
const outDir = resolve(root, values.out);
const clientPort = Number(process.env.WORLD_CLIENT_PORT ?? 5173);
const clientUrl = `http://localhost:${clientPort}`;

type Point = readonly [x: number, y: number, z: number];

/** Where the eye is and the point it looks at. */
interface Viewpoint {
  readonly name: string;
  readonly eye: Point;
  readonly at: Point;
}

const E = EYE_HEIGHT;

export const VIEWPOINTS: readonly Viewpoint[] = [
  // The cooking suite under the hood, from the aisle between it and the pass.
  { name: 'suite', eye: [-1.2, E, 2.75], at: [1.0, 1.05, -0.2] },
  // The five dishes on the pass under their heat lamps, from the dining room side.
  { name: 'pass', eye: [-0.9, 1.5, 5.55], at: [0.2, 0.98, 4.3] },
  // The pastry island and its croquembouche under a pendant, the windows behind.
  { name: 'islands', eye: [-0.3, E, -2.6], at: [-3.2, 1.0, -4.3] },
  // The long window counter with its sinks and taps, looking west along it.
  { name: 'window-counter', eye: [0.4, E, -5.25], at: [-4.5, 1.05, -6.2] },
  // The white walls, the barrel vault, its skylights and the hood, from the north-west corner.
  { name: 'vault', eye: [-7.0, E, -4.6], at: [2.5, 4.0, 0.6] },
  // The floor down the aisle between the piano and the pass, at a grazing angle.
  { name: 'floor', eye: [-6.6, E, 2.7], at: [0.5, 0.0, 2.7] },
  // The walk-in's steel door in the east wall, its frame and controller, the fridge beside it.
  { name: 'walk-in', eye: [5.4, E, -1.4], at: [8.0, 1.15, -3.1] },
  // The chef's desk in the south-west corner and the kitchen computer on it.
  { name: 'desk', eye: [-5.7, E, 4.5], at: [-7.7, 1.1, 5.6] },
];

/** The look along eye to target, as the player's yaw (0 north, toward -z) and pitch (up positive). */
function look(eye: Point, at: Point): { yaw: number; pitch: number } {
  const dx = at[0] - eye[0];
  const dy = at[1] - eye[1];
  const dz = at[2] - eye[2];
  return { yaw: Math.atan2(-dx, -dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)) };
}

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  let client: ChildProcess | null = null;
  if (!(await reachable(clientUrl))) {
    client = spawn(
      'npm',
      ['run', 'dev', '-w', '@world/client', '--', '--port', String(clientPort)],
      {
        cwd: root,
        stdio: 'ignore',
      },
    );
    const deadline = Date.now() + 30_000;
    while (!(await reachable(clientUrl))) {
      if (Date.now() > deadline) throw new Error(`${clientUrl} did not come up`);
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  const only = values.only?.split(',');
  const views = VIEWPOINTS.filter((v) => !only || only.includes(v.name));
  const browser = await chromium.launch({
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: Number(values.dpr),
    });
    const page = await context.newPage();
    for (const view of views) {
      const { yaw, pitch } = look(view.eye, view.at);
      const params = new URLSearchParams({
        quality: values.quality,
        time: values.time,
        governor: 'off',
        view: [...view.eye, yaw, pitch].map((n) => n.toFixed(4)).join(','),
      });
      const started = Date.now();
      await page.goto(`${clientUrl}/?${params}`);
      await page.getByRole('button', { name: 'Enter the kitchen' }).waitFor({ timeout: 60_000 });
      const loadMs = Date.now() - started;
      await page.addStyleTag({ content: '.ui, #loading { display: none !important; }' });
      // Let the first frames settle (the outside is painted for the hour once the page is idle).
      await page.waitForTimeout(1500);
      await page.screenshot(
        values.format === 'png'
          ? { path: `${outDir}/${view.name}.png` }
          : { path: `${outDir}/${view.name}.jpg`, type: 'jpeg', quality: 90 },
      );
      console.log(`${view.name}: loaded in ${loadMs} ms`);
    }
    console.log(`Viewpoints written to ${outDir}`);
  } finally {
    await browser.close();
    client?.kill('SIGINT');
  }
}

await main();
