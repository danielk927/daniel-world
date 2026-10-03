/**
 * Performance check with a full room: 15 bots plus one real browser (16 players).
 *
 *   node scripts/perf.ts
 *
 * Needs the dev client on :5173 (`npm run dev -w @world/client`); starts a room server if none is
 * running. Reports frame rate, main-thread time per frame, draw calls and JS heap growth.
 */
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { DEFAULT_SERVER_PORT, MAX_PLAYERS_PER_ROOM } from '@world/shared';
import { startServer } from '../apps/server/src/server.ts';

const root = resolve(import.meta.dirname, '..');
const clientUrl = 'http://localhost:5173';
const room = 'perf';
const sampleSeconds = 12;

async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

if (!(await reachable(clientUrl))) {
  console.error(`Start the client first: npm run dev -w @world/client`);
  process.exit(1);
}
const ownServer = (await reachable(`http://localhost:${DEFAULT_SERVER_PORT}/health`))
  ? null
  : await startServer({ port: DEFAULT_SERVER_PORT });
const bots = spawn(
  'node',
  ['scripts/bots.ts', '--count', String(MAX_PLAYERS_PER_ROOM - 1), '--room', room, '--chat'],
  { cwd: root, stdio: 'ignore' },
);

const browser = await chromium.launch({
  // Real GPU; precise memory info so heap growth is measured, not bucketed.
  args: [
    '--use-angle=metal',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    '--enable-precise-memory-info',
  ],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${clientUrl}/?quality=high`);
  await page.getByRole('button', { name: 'Enter world' }).waitFor({ timeout: 30_000 });
  await page.getByLabel('Room code').fill(room);
  await page.getByRole('button', { name: 'Enter world' }).click();
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
  const samples: { fps: number; frameCpuMs: number; drawCalls: number; triangles: number }[] = [];
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
  }));

  const avg = (key: keyof (typeof samples)[number]): number =>
    samples.reduce((sum, s) => sum + s[key], 0) / samples.length;
  const report = {
    players: state.players,
    fpsAvg: Number(avg('fps').toFixed(1)),
    fpsMin: Number(Math.min(...samples.map((s) => s.fps)).toFixed(1)),
    frameCpuMsAvg: Number(avg('frameCpuMs').toFixed(2)),
    drawCalls: Math.round(avg('drawCalls')),
    triangles: Math.round(avg('triangles')),
    heapGrowthKB: Math.round((heapAfter - heapBefore) / 1024),
    maxPredictionCorrection: state.maxCorrection,
  };
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  bots.kill('SIGINT');
  await ownServer?.close();
}
