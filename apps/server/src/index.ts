import { DEFAULT_SERVER_PORT } from '@world/shared';
import { startServer } from './server.ts';

// Configuration comes from the environment so the same bundle runs locally and on a host.
const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const host = process.env.HOST;
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const trustProxy = process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true';

const server = await startServer({
  port,
  ...(host ? { host } : {}),
  ...(allowedOrigins?.length ? { allowedOrigins } : {}),
  trustProxy,
  log: (message) => console.log(`[${new Date().toISOString()}] ${message}`),
});
console.log(
  `World server listening on :${server.port}` +
    (allowedOrigins?.length ? ` (origins: ${allowedOrigins.join(', ')})` : ''),
);

const shutdown = (): void => {
  void server.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
