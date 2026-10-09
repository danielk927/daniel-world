import { defineConfig } from '@playwright/test';
import { E2E_CLIENT_PORT, E2E_CLIENT_URL, E2E_SERVER_URL } from './e2e/ports.ts';

/**
 * The test build has the room server's address baked in, so each client port builds its own: two
 * suites on other ports can run at once, even in one checkout, each pointing its pages at its own
 * server.
 */
const outDir = `dist-test-${E2E_CLIENT_PORT}`;

export default defineConfig({
  testDir: 'e2e',
  // Tests share one room server process and start/stop it, so run serially.
  workers: 1,
  fullyParallel: false,
  // Several software-rendered pages share the CPU, so give each test generous room.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: E2E_CLIENT_URL,
    browserName: 'chromium',
    viewport: { width: 1280, height: 720 },
    launchOptions: {
      // Software WebGL so the suite runs on machines and CI runners without a GPU.
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
    // Every action, the DOM before and after it, the console and the network, but no screencast:
    // filming every animating canvas made a three-page test take half as long again.
    trace: { mode: 'retain-on-failure', screenshots: false },
  },
  webServer: {
    command: [
      `npx vite build --mode test --outDir ${outDir}`,
      `npx vite preview --outDir ${outDir} --host 127.0.0.1 --port ${E2E_CLIENT_PORT}`,
    ].join(' && '),
    cwd: 'apps/client',
    env: { VITE_SERVER_URL: E2E_SERVER_URL },
    url: E2E_CLIENT_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
