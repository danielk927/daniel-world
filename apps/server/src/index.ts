import { DEFAULT_SERVER_PORT } from '@world/shared';
import { startServer } from './server.ts';

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const host = process.env.HOST;

const server = await startServer({
  port,
  ...(host ? { host } : {}),
  log: (message) => console.log(`[${new Date().toISOString()}] ${message}`),
});
console.log(`World server listening on :${server.port}`);

const shutdown = (): void => {
  void server.close().then(() => process.exit(0));
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
