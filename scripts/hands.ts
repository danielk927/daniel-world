/**
 * The hand on screen holding knives, for judging the view model: each knife at rest and caught at
 * moments of its inspect, on the real GPU, the same frames before and after a change.
 *
 *   node scripts/hands.ts [--out <dir>] [--dpr 1] [--looks karambit/doppler,m9/tiger]
 *                         [--at rest,0.3,0.55,menu] [--time 20:00] [--quality high]
 *
 * `--at` takes `rest`, shares of each knife's inspect (0.3 is 30 % of the way through it) and `menu`,
 * the knife on the Knives page of the pause menu.
 * Starts the Vite dev client and a room server if they are not up (WORLD_CLIENT_PORT and
 * WORLD_SERVER_PORT move them), enters a private party alone with each knife equipped, and holds
 * the page's clock (Playwright's fake clock) so every frame is taken at exactly the same moment of
 * the animation. The quality governor is held at its best level and the interface hidden.
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium, type Page } from '@playwright/test';
import { DEFAULT_SERVER_PORT } from '@world/shared';
import { startServer, type WorldServer } from '../apps/server/src/server.ts';
import { reachable, startClient, stopAll, waitFor } from './processes.ts';

const root = resolve(import.meta.dirname, '..');
const { values } = parseArgs({
  options: {
    out: { type: 'string', default: 'docs/hands' },
    dpr: { type: 'string', default: '1' },
    looks: {
      type: 'string',
      default:
        'kitchen/stock,kitchen/damascus,karambit/doppler,butterfly/fade,m9/tiger,bayonet/case',
    },
    at: { type: 'string', default: 'rest,0.3,0.55,menu' },
    time: { type: 'string', default: '20:00' },
    quality: { type: 'string', default: 'high' },
  },
});
const outDir = resolve(root, values.out);
const clientPort = Number(process.env.WORLD_CLIENT_PORT ?? 5173);
const serverPort = Number(process.env.WORLD_SERVER_PORT ?? DEFAULT_SERVER_PORT);
const clientUrl = `http://localhost:${clientPort}`;
const serverUrl = `ws://localhost:${serverPort}`;

/** Step the page's held clock by `ms`, a display frame at a time, so the game sees every frame. */
async function run(page: Page, ms: number): Promise<void> {
  const frame = 1000 / 60;
  for (let t = 0; t < ms; t += frame) await page.clock.runFor(frame);
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  let ownServer: WorldServer | null = null;
  try {
    if (!(await reachable(clientUrl))) {
      await waitFor(clientUrl, 30_000, startClient(clientPort, serverUrl));
    }
    if (!(await reachable(`http://localhost:${serverPort}/health`))) {
      ownServer = await startServer({ port: serverPort, chef: false });
    }
    const browser = await chromium.launch({
      args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
    });
    try {
      const moments = values.at.split(',');
      for (const look of values.looks.split(',')) {
        const [skin, finish] = look.split('/');
        const context = await browser.newContext({
          viewport: { width: 1440, height: 900 },
          deviceScaleFactor: Number(values.dpr),
        });
        await context.addInitScript(
          ([skin, finish]) => {
            localStorage.removeItem('world.renderLevel');
            localStorage.setItem('world.settings', JSON.stringify({ knife: { skin, finish } }));
          },
          [skin, finish],
        );
        const page = await context.newPage();
        await page.clock.install();
        const params = new URLSearchParams({
          quality: values.quality,
          time: values.time,
          governor: 'off',
        });
        await page.goto(`${clientUrl}/?${params}`);
        await page.getByRole('button', { name: 'Enter the kitchen' }).waitFor({ timeout: 60_000 });
        await page.getByLabel('Your name').fill('Hands');
        await page.getByRole('button', { name: 'Private party' }).click();
        await page.getByRole('textbox', { name: 'Party code' }).fill(`hands-${skin}`);
        await page.getByRole('button', { name: 'Enter the kitchen' }).click();
        await page.waitForFunction(() => window.__world?.mode === 'playing', null, {
          timeout: 60_000,
        });
        const hidden = await page.addStyleTag({
          content: '.ui, #loading { display: none !important; }',
        });
        // Let the draw play out and the knife settle, then hold the clock.
        await page.waitForTimeout(3000);
        await page.clock.pauseAt(Date.now() + 1000);
        await run(page, 1500);
        const name = `${skin}-${finish}`;
        for (const moment of moments) {
          if (moment === 'rest') {
            await page.screenshot({ path: `${outDir}/${name}-rest.png` });
            continue;
          }
          if (moment === 'menu') {
            // The Knives page of the pause menu, its own renderer turning the knife.
            await hidden.evaluate((style) => (style as Element).remove());
            await page.keyboard.press('Escape');
            const menu = page.getByRole('dialog', { name: 'Paused' });
            await menu.getByRole('tab', { name: 'Knives' }).click();
            await run(page, 1200);
            await page.locator('.knife-preview').screenshot({ path: `${outDir}/${name}-menu.png` });
            continue;
          }
          await page.keyboard.press('KeyI');
          await run(page, 50);
          if ((await page.evaluate(() => window.__world!.inspectTime)) === null) {
            throw new Error(`${name}: the inspect did not start`);
          }
          // Find the inspect's length by running it out, then start it again and stop at the share.
          let length = 0;
          while ((await page.evaluate(() => window.__world!.inspectTime)) !== null) {
            await run(page, 100);
            length += 0.1;
            if (length > 20) throw new Error(`${name}: the inspect never ended`);
          }
          await run(page, 1000);
          await page.keyboard.press('KeyI');
          await run(page, Number(moment) * length * 1000);
          await page.screenshot({ path: `${outDir}/${name}-${moment}.png` });
          await run(page, length * 1000 + 1000);
        }
        console.log(`${name}: done`);
        await context.close();
      }
      console.log(`Frames written to ${outDir}`);
    } finally {
      await browser.close();
    }
  } finally {
    await stopAll();
    await ownServer?.close();
  }
}

await main();
