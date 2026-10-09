/**
 * The E2E suite's room server, in a process of its own: started by `startRoomServer` in
 * roomServer.ts, which talks to it over the IPC channel `fork` opens. Run by Node directly, so
 * erasable TypeScript only, as everywhere.
 *
 * A server inside the test process ticks only when that process is free, and Playwright's own work
 * there (driving pages, writing traces) on a busy machine can hold it up for seconds, long enough
 * for every page to give up on a silent server and drop to solo.
 */
import { startServer } from '../apps/server/src/server.ts';
import type { ServerEvent, ServerRequest } from './roomServer.ts';

const port = Number(process.argv[2]);

function send(event: ServerEvent): void {
  process.send?.(event);
}

// The test process is gone, so nobody will close this server: go too.
process.on('disconnect', () => process.exit(0));

try {
  const server = await startServer({
    port,
    host: '127.0.0.1',
    chef: true,
    log: (line) => send({ kind: 'log', line: `${new Date().toISOString()} ${line}` }),
  });
  process.on('message', (request: ServerRequest) => {
    if (request.kind === 'close') {
      // The test hears it as this process exiting, by then with the port free again.
      void server.close().then(() => process.exit(0));
      return;
    }
    const room = server.rooms.get(request.code);
    const value = room
      ? {
          players: [...room.players.values()].map(({ id, name, prefs }) => ({ id, name, prefs })),
        }
      : null;
    send({ kind: 'reply', id: request.id, value });
  });
  send({ kind: 'ready', port: server.port });
} catch (error) {
  send({ kind: 'failed', message: String(error) });
  process.exit(1);
}
