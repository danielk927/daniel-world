/**
 * Visual QA: captures the main screens into docs/screenshots/.
 *
 *   node scripts/screenshots.ts
 *
 * Starts whatever is missing (Vite dev client on :5173, room server on :3001) plus a few bots so
 * the world has people in it, then drives a real (GPU-backed, headless) Chromium like a visitor.
 * The hour is pinned to evening service (8 p.m.), so the pictures do not depend on when they are taken.
 * WORLD_CLIENT_PORT and WORLD_SERVER_PORT move both off their usual ports, to run beside another copy.
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';
import { DEFAULT_SERVER_PORT } from '@world/shared';
import { startServer, type WorldServer } from '../apps/server/src/server.ts';
import { reachable, start, startClient, stopAll, waitFor } from './processes.ts';

const outDir = resolve(import.meta.dirname, '../docs/screenshots');
const clientPort = Number(process.env.WORLD_CLIENT_PORT ?? 5173);
const serverPort = Number(process.env.WORLD_SERVER_PORT ?? DEFAULT_SERVER_PORT);
const clientUrl = `http://localhost:${clientPort}`;
const serverUrl = `ws://localhost:${serverPort}`;

async function enter(page: Page, name: string, room = ''): Promise<void> {
  await page.goto(`${clientUrl}/?quality=high&time=20:00`);
  // Other pages may still be rendering on the same GPU, so loading can take a while.
  await page.getByRole('button', { name: 'Enter the kitchen' }).waitFor({ timeout: 60_000 });
  await page.getByLabel('Your name').fill(name);
  if (room) {
    await page.getByRole('button', { name: 'Private party' }).click();
    await page.getByLabel('Private party').fill(room);
  }
  await page.getByRole('button', { name: 'Enter the kitchen' }).click();
  await page.waitForFunction(() => window.__world?.mode === 'playing', null, { timeout: 60_000 });
}

/** Drag the view to a yaw and pitch, the way a visitor without pointer lock looks around. */
async function turnTo(page: Page, yaw: number, pitch: number): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const look = await page.evaluate(() => window.__world!.look);
    const dYaw = look.yaw - yaw;
    const dPitch = pitch - look.pitch;
    if (Math.abs(dYaw) < 0.01 && Math.abs(dPitch) < 0.01) return;
    const clamp = (v: number): number => Math.max(-200, Math.min(200, v * 250));
    // Out and back, so even a tiny correction is a drag and never a click on a station.
    await page.mouse.move(720, 450);
    await page.mouse.down();
    await page.mouse.move(720, 390, { steps: 2 });
    await page.mouse.move(720 + clamp(dYaw), 450 - clamp(dPitch), { steps: 4 });
    await page.mouse.up();
  }
}

/** Hold a key until the player reaches a spot, like a person walking there. */
async function walkUntil(
  page: Page,
  key: string,
  arrived: (p: { x: number; z: number }) => boolean,
): Promise<void> {
  await page.keyboard.down(key);
  try {
    for (let i = 0; i < 400; i++) {
      if (arrived(await page.evaluate(() => window.__world!.player))) return;
      await page.waitForTimeout(25);
    }
    throw new Error(`never arrived while holding ${key}`);
  } finally {
    await page.keyboard.up(key);
  }
}

async function main(): Promise<void> {
  await mkdir(outDir, { recursive: true });
  let ownServer: WorldServer | null = null;
  let browser: Browser | null = null;
  try {
    if (!(await reachable(clientUrl))) {
      await waitFor(clientUrl, 30_000, startClient(clientPort, serverUrl));
    }
    if (!(await reachable(`http://localhost:${serverPort}/health`))) {
      ownServer = await startServer({ port: serverPort });
    }
    start(process.execPath, ['scripts/bots.ts', '--count', '6', '--chat', '--url', serverUrl]);

    browser = await chromium.launch({
      args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
    });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    await page.goto(`${clientUrl}/?quality=high&time=20:00`);
    await page.getByRole('button', { name: 'Enter the kitchen' }).waitFor({ timeout: 30_000 });
    await page.getByLabel('Your name').fill('Curious Otter');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${outDir}/landing.png` });

    // The lobby, with the bots wandering around.
    await page.getByRole('button', { name: 'Enter the kitchen' }).click();
    await page.waitForFunction(() => window.__world?.mode === 'playing', null, { timeout: 30_000 });
    await page.keyboard.press('Enter');
    await page.keyboard.type('hi everyone!');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${outDir}/world.png` });

    await page.keyboard.press('Escape');
    await page.getByRole('dialog', { name: 'Paused' }).waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${outDir}/pause.png` });

    // A private room, alone, walking up to the pâtisserie and its croquembouche.
    const reader = await context.newPage();
    await enter(reader, 'Reader', 'docs');
    // Round the west end of the pass and the piano, then up to the pastry island.
    await walkUntil(reader, 'KeyA', (p) => p.x < -5.3);
    await walkUntil(reader, 'KeyW', (p) => p.z < -2.6);
    await walkUntil(reader, 'KeyD', (p) => p.x > -3.2);
    await walkUntil(reader, 'KeyW', (p) => p.z < -2.9);
    await reader.mouse.move(720, 450);
    await reader.getByText('Press E to open Interests').waitFor();
    await reader.waitForTimeout(600);
    await reader.screenshot({ path: `${outDir}/lore-object.png` });
    await reader.keyboard.press('KeyE');
    await reader.getByRole('dialog', { name: 'Interests' }).waitFor();
    await reader.waitForTimeout(600);
    await reader.screenshot({ path: `${outDir}/info-panel.png` });
    // Done with it: a page left open keeps rendering and slows the next ones down.
    await reader.close();

    // Knives in a private room: two stuck in the wall past a cook, then one that knocks them out.
    const thrower = await context.newPage();
    await enter(thrower, 'Thrower', 'docs-knives');
    const target = await context.newPage();
    await enter(target, 'Target', 'docs-knives');
    await thrower.waitForTimeout(1000);
    const from = await thrower.evaluate(() => window.__world!.player);
    const to = await target.evaluate(() => window.__world!.player);
    const toward = Math.atan2(-(to.x - from.x), -(to.z - from.z));
    for (const [yaw, pitch] of [
      [toward + 0.35, 0.05],
      [toward - 0.3, 0.1],
    ] as const) {
      await turnTo(thrower, yaw, pitch);
      await thrower.mouse.click(720, 450);
      await thrower.waitForTimeout(900);
    }
    await turnTo(thrower, toward, -0.04);
    await thrower.mouse.click(1300, 120);
    await thrower.waitForFunction(() => window.__world!.remotePlayers.length > 0);
    await thrower.waitForTimeout(900);
    await thrower.screenshot({ path: `${outDir}/knives.png` });

    // Inspecting the knife (I), caught with the flat of the blade turned to the eye.
    await thrower.waitForTimeout(1500);
    await thrower.keyboard.press('KeyI');
    await thrower.waitForTimeout(700);
    await thrower.screenshot({ path: `${outDir}/inspect.png` });
    await thrower.close();
    await target.close();

    // The kitchen computer in the south-west corner, booted into DOOM's first level.
    const gamer = await context.newPage();
    await enter(gamer, 'Gamer', 'docs-computer');
    await gamer.keyboard.press('KeyQ'); // the bare hand, so a stray click punches, not throws
    await walkUntil(gamer, 'KeyA', (p) => p.x < -6.2);
    await turnTo(gamer, Math.PI / 2, -0.32);
    await gamer.mouse.move(720, 450);
    await gamer.getByText('Press E to play DOOM').waitFor();
    await gamer.waitForTimeout(400);
    await gamer.screenshot({ path: `${outDir}/computer-desk.png` });
    await gamer.keyboard.press('KeyE');
    await gamer.waitForFunction(() => window.__world!.computer.frames > 60);
    for (const key of ['Enter', 'Enter', 'Enter', 'Enter']) {
      await gamer.keyboard.press(key);
      await gamer.waitForTimeout(600);
    }
    await gamer.waitForTimeout(1500);
    await gamer.screenshot({ path: `${outDir}/computer-doom.png` });
    await gamer.close();

    await page.goto(`${clientUrl}/portfolio.html`);
    await page.screenshot({ path: `${outDir}/portfolio.png`, fullPage: true });
    const phone = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
    });
    const phonePage = await phone.newPage();
    await phonePage.goto(`${clientUrl}/`);
    await phonePage.getByRole('button', { name: 'Enter the kitchen' }).waitFor({ timeout: 30_000 });
    await phonePage.waitForTimeout(1500);
    await phonePage.screenshot({ path: `${outDir}/mobile-landing.png` });
    await phonePage.goto(`${clientUrl}/portfolio.html`);
    await phonePage.screenshot({ path: `${outDir}/mobile-portfolio.png` });
    console.log(`Screenshots written to ${outDir}`);
  } finally {
    await browser?.close();
    await stopAll();
    await ownServer?.close();
  }
}

await main();
