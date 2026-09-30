import { afterEach, describe, expect, it, vi } from 'vitest';

async function resolveWith(page: string, configured: string | undefined): Promise<string> {
  vi.stubGlobal('location', new URL(page));
  const { resolveServerUrl } = await import('./env.ts');
  return resolveServerUrl(configured);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('resolveServerUrl', () => {
  it('defaults to the dev server on the page host', async () => {
    expect(await resolveWith('http://192.168.1.20:5173/', undefined)).toBe(
      'ws://192.168.1.20:3001',
    );
  });

  it('resolves a path against the page origin, upgrading to wss on https', async () => {
    expect(await resolveWith('https://d123.cloudfront.net/', '/ws')).toBe(
      'wss://d123.cloudfront.net/ws',
    );
    expect(await resolveWith('http://localhost:4173/', '/ws')).toBe('ws://localhost:4173/ws');
  });

  it('uses a full URL as is', async () => {
    expect(await resolveWith('https://site.example/', 'wss://server.example')).toBe(
      'wss://server.example',
    );
  });
});
