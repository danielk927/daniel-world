/**
 * Visual QA: captures the main screens into docs/screenshots/.
 *
 *   node scripts/screenshots.ts
 *
 * Starts whatever is missing (Vite dev client on :5173, room server on :3001) plus a few bots so
 * the world has people in it, then drives a real (GPU-backed, headless) Chromium like a visitor.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { DEFAULT_SERVER_PORT } from '@world/shared';
import { startServer } from '../apps/server/src/server.ts';

const root = resolve(import.meta.dirname, '..');
const outDir = resolve(root, 'docs/screenshots');
const clientUrl = 'http://localhost:5173';
const children: ChildProcess[] = [];

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

async function waitFor(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await reachable(url))) {
    if (Date.now() > deadline) throw new Error(`${url} did not come up`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

function run(command: string, args: string[]): ChildProcess {
  const child = spawn(command, args, { cwd: root, stdio: 'ignore' });
  children.push(child);
  return child;
}

async function enter(page: Page, name: string, room = ''): Promise<void> {
  await page.goto(`${clientUrl}/?quality=high`);
  await page.getByRole('button', { name: 'Enter world' }).waitFor({ timeout: 30_000 });
  await page.getByLabel('Your name').fill(name);
  await page.getByLabel('Room code').fill(room);
  await page.getByRole('button', { name: 'Enter world' }).click();
  await page.waitForFunction(() => window.__world?.mode === 'playing', null, { timeout: 30_000 });
}

async function hold(page: Page, key: string, ms: number): Promise<void> {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
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
  if (!(await reachable(clientUrl))) {
    run('npm', ['run', 'dev', '-w', '@world/client']);
    await waitFor(clientUrl, 30_000);
  }
  const ownServer = (await reachable(`http://localhost:${DEFAULT_SERVER_PORT}/health`))
    ? null
    : await startServer({ port: DEFAULT_SERVER_PORT });
  run('node', ['scripts/bots.ts', '--count', '6', '--chat']);

  const browser = await chromium.launch({
    args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();

    await page.goto(`${clientUrl}/?quality=high`);
    await page.getByRole('button', { name: 'Enter world' }).waitFor({ timeout: 30_000 });
    await page.getByLabel('Your name').fill('Curious Otter');
    await page.waitForTimeout(2500);
    await page.screenshot({ path: `${outDir}/landing.png` });

    // The lobby, with the bots wandering around.
    await page.getByRole('button', { name: 'Enter world' }).click();
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
    await reader.getByText('Click to open Pâtisserie').waitFor();
    await reader.waitForTimeout(600);
    await reader.screenshot({ path: `${outDir}/lore-object.png` });
    await reader.mouse.click(720, 450);
    await reader.getByRole('dialog', { name: 'Pâtisserie' }).waitFor();
    await reader.waitForTimeout(600);
    await reader.screenshot({ path: `${outDir}/info-panel.png` });

    // Two players in a private room with a round of tag running.
    const runner = await context.newPage();
    await enter(runner, 'Runner', 'docs-tag');
    const chaser = await context.newPage();
    await enter(chaser, 'Chaser', 'docs-tag');
    await runner.keyboard.press('Escape');
    await runner.getByRole('button', { name: 'Play tag' }).click();
    await runner.waitForFunction(() => window.__world?.game !== null, null, { timeout: 10_000 });
    await hold(runner, 'KeyD', 500);
    await runner.waitForTimeout(1500);
    await runner.screenshot({ path: `${outDir}/tag.png` });

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
    await phonePage.getByRole('button', { name: 'Enter world' }).waitFor({ timeout: 30_000 });
    await phonePage.waitForTimeout(1500);
    await phonePage.screenshot({ path: `${outDir}/mobile-landing.png` });
    await phonePage.goto(`${clientUrl}/portfolio.html`);
    await phonePage.screenshot({ path: `${outDir}/mobile-portfolio.png` });
    console.log(`Screenshots written to ${outDir}`);
  } finally {
    await browser.close();
    for (const child of children) child.kill('SIGINT');
    await ownServer?.close();
  }
}

await main();
