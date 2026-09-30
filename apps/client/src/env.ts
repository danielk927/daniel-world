import { DEFAULT_SERVER_PORT } from '@world/shared';

/**
 * WebSocket URL of the room server.
 * - Unset: the dev server on the same host (`ws://<host>:3001`).
 * - A path such as `/ws`: same origin as the page (used when CloudFront serves both).
 * - A full URL such as `wss://server.example.com`: used as is.
 */
export function resolveServerUrl(configured: string | undefined): string {
  if (!configured) return `ws://${location.hostname || 'localhost'}:${DEFAULT_SERVER_PORT}`;
  if (configured.startsWith('/')) {
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${scheme}//${location.host}${configured}`;
  }
  return configured;
}

export const SERVER_URL: string = resolveServerUrl(import.meta.env.VITE_SERVER_URL);

/** HTTP base of the same server, used for the landing page player count. */
export const SERVER_HTTP_URL: string = SERVER_URL.replace(/^ws/, 'http').replace(/\/$/, '');
