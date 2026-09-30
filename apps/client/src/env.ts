import { DEFAULT_SERVER_PORT } from '@world/shared';

/** WebSocket URL of the room server. Defaults to the dev server on the same host. */
export const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL ??
  `ws://${location.hostname || 'localhost'}:${DEFAULT_SERVER_PORT}`;

/** HTTP base of the same server, used for the landing page player count. */
export const SERVER_HTTP_URL: string = SERVER_URL.replace(/^ws/, 'http').replace(/\/$/, '');
