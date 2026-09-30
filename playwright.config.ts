import { defineConfig } from '@playwright/test';
import { E2E_CLIENT_URL, E2E_SERVER_URL } from './e2e/ports.ts';

export default defineConfig({
  testDir: 'e2e',
  // Tests share one room server process and start/stop it, so run serially.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
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
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'npm run build:test -w @world/client && npm run preview:test -w @world/client',
    env: { VITE_SERVER_URL: E2E_SERVER_URL },
    url: E2E_CLIENT_URL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
