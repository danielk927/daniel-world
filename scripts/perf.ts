/**
 * Performance check with a full room: 15 bots plus one real browser (16 players).
 *
 *   node scripts/perf.ts [--dpr 2]
 *
 * Starts whatever is missing (Vite dev client on :5173, room server on :3001), on the real GPU at
 * the high tier and the evening hour. Reports frame rate, main-thread time per frame, draw calls,
 * JS heap growth and the quality governor's level at the end (0 is best: a higher one means the
 * GPU could not keep up). `--dpr 2` measures a retina screen, four times the pixels.
 * WORLD_CLIENT_PORT and WORLD_SERVER_PORT move both off their usual ports, to run beside another copy.
 */
import { parseArgs } from 'node:util';
import { chromium, type Browser } from '@playwright/test';
import { DEFAULT_SERVER_PORT, MAX_PLAYERS_PER_ROOM } from '@world/shared';
import { startServer, type WorldServer } from '../apps/server/src/server.ts';
import { reachable, start, startClient, stopAll, waitFor } from './processes.ts';

const { values } = parseArgs({ options: { dpr: { type: 'string', default: '1' } } });
const deviceScaleFactor = Number(values.dpr);
const clientPort = Number(process.env.WORLD_CLIENT_PORT ?? 5173);
const serverPort = Number(process.env.WORLD_SERVER_PORT ?? DEFAULT_SERVER_PORT);
const clientUrl = `http://localhost:${clientPort}`;
const serverUrl = `ws://localhost:${serverPort}`;
const room = 'perf';
const sampleSeconds = 12;

let ownServer: WorldServer | null = null;
let browser: Browser | null = null;
try {
  if (!(await reachable(clientUrl))) {
    await waitFor(clientUrl, 30_000, startClient(clientPort, serverUrl));
  }
  if (!(await reachable(`http://localhost:${serverPort}/health`))) {
    ownServer = await startServer({ port: serverPort });
  }
  start(process.execPath, [
    'scripts/bots.ts',
    '--count',
    String(MAX_PLAYERS_PER_ROOM - 1),
    '--room',
    room,
    '--url',
    serverUrl,
    '--chat',
    '--knives',
  ]);

  browser = await chromium.launch({
    // Real GPU; precise memory info so heap growth is measured, not bucketed.
    args: [
      '--use-angle=metal',
      '--enable-gpu',
      '--ignore-gpu-blocklist',
      '--enable-precise-memory-info',
    ],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor });
  await page.goto(`${clientUrl}/?quality=high&time=20:00`);
  await page.getByRole('button', { name: 'Enter the kitchen' }).waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Private party' }).click();
  await page.getByRole('textbox', { name: 'Party code' }).fill(room);
  await page.getByRole('button', { name: 'Enter the kitchen' }).click();
  await page.waitForFunction(
    (expected) => window.__world?.mode === 'playing' && window.__world.playerCount === expected,
    MAX_PLAYERS_PER_ROOM,
    { timeout: 30_000 },
  );
  // Stay at the spawn, facing the piano with the bots wandering around it, and let things settle.
  await page.waitForTimeout(2800);

  const heapBefore = await page.evaluate(
    () =>
      (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ??
      0,
  );
  const samples: {
    fps: number;
    frameCpuMs: number;
    drawCalls: number;
    triangles: number;
    level: number | null;
  }[] = [];
  for (let i = 0; i < sampleSeconds; i++) {
    await page.waitForTimeout(1000);
    samples.push(await page.evaluate(() => window.__world!.renderer));
  }
  const heapAfter = await page.evaluate(
    () =>
      (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ??
      0,
  );
  const state = await page.evaluate(() => ({
    players: window.__world!.playerCount,
    maxCorrection: window.__world!.prediction.maxCorrection,
    knives: window.__world!.knives,
  }));

  const avg = (key: 'fps' | 'frameCpuMs' | 'drawCalls' | 'triangles'): number =>
    samples.reduce((sum, s) => sum + s[key], 0) / samples.length;
  const report = {
    deviceScaleFactor,
    players: state.players,
    stuckKnives: state.knives.stuck,
    fpsAvg: Number(avg('fps').toFixed(1)),
    fpsMin: Number(Math.min(...samples.map((s) => s.fps)).toFixed(1)),
    frameCpuMsAvg: Number(avg('frameCpuMs').toFixed(2)),
    drawCalls: Math.round(avg('drawCalls')),
    triangles: Math.round(avg('triangles')),
    heapGrowthKB: Math.round((heapAfter - heapBefore) / 1024),
    governorLevel: samples[samples.length - 1]!.level,
    maxPredictionCorrection: state.maxCorrection,
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  await stopAll();
  await ownServer?.close();
}
