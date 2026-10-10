/**
 * The E2E suite's room server, in a process of its own: started by `startRoomServer` in
 * roomServer.ts, which talks to it over the IPC channel `fork` opens. Run by Node directly, so
 * erasable TypeScript only, as everywhere.
 *
 * A server inside the test process ticks only when that process is free, and Playwright's own work
 * there (driving pages, writing traces) on a busy machine can hold it up for seconds, long enough
 * for every page to give up on a silent server and drop to solo.
 */
import type { Chef } from '../apps/server/src/chef.ts';
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
  /** Whom each watched Chef Skinner has wound up to throw at, by room. */
  const watched = new Map<string, { chef: Chef; targets: Set<number> }>();
  const answer = (request: Exclude<ServerRequest, { kind: 'close' }>): unknown => {
    switch (request.kind) {
      case 'room': {
        const room = server.rooms.get(request.code);
        if (!room) return null;
        const players = [...room.players.values()];
        return {
          players: players.map(({ id, name, prefs, resident, state }) => ({
            id,
            name,
            prefs,
            resident,
            x: state.x,
            z: state.z,
          })),
        };
      }
      case 'watchChef': {
        const chef = server.chef(request.code);
        if (chef && watched.get(request.code)?.chef !== chef) {
          // Every tick, after he decides: a cook he picks is his target from that tick on.
          const targets = new Set<number>();
          const think = chef.think.bind(chef);
          chef.think = () => {
            think();
            if (chef.target !== null) targets.add(chef.target);
          };
          watched.set(request.code, { chef, targets });
        }
        return chef !== undefined;
      }
      case 'chefTargets': {
        const watch = watched.get(request.code);
        if (!watch) return null;
        const still = server.chef(request.code) === watch.chef;
        return { targets: [...watch.targets], watching: still };
      }
    }
  };
  process.on('message', (request: ServerRequest) => {
    if (request.kind === 'close') {
      // The test hears it as this process exiting, by then with the port free again.
      void server.close().then(() => process.exit(0));
      return;
    }
    send({ kind: 'reply', id: request.id, value: answer(request) });
  });
  send({ kind: 'ready', port: server.port });
} catch (error) {
  send({ kind: 'failed', message: String(error) });
  process.exit(1);
}
