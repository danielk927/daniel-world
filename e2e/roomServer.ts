import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import type { Prefs } from '@world/shared';
import { E2E_SERVER_PORT } from './ports.ts';

/** Who is in a room, and where each of them stands on the floor, as the room server has it. */
export interface RoomView {
  readonly players: readonly {
    id: number;
    name: string;
    prefs: Prefs;
    resident: boolean;
    x: number;
    z: number;
  }[];
}

export type ServerRequest =
  | {
      readonly kind: 'room' | 'watchChef' | 'chefTargets';
      readonly id: number;
      readonly code: string;
    }
  | { readonly kind: 'close' };

/** Whom Chef Skinner has wound up to throw at since he was watched, by player id. */
export interface ChefTargets {
  readonly targets: readonly number[];
  /** Whether he is still the one watched: a room that empties loses him, and a new one comes. */
  readonly watching: boolean;
}

export type ServerEvent =
  | { readonly kind: 'ready'; readonly port: number }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'log'; readonly line: string }
  | { readonly kind: 'reply'; readonly id: number; readonly value: unknown };

/**
 * The real room server, with Chef Skinner locked in every room's walk-in as in production, run in a
 * process of its own (roomServerProcess.ts) so it keeps time however busy the test process is, and
 * so tests can stop and restart it.
 */
export interface RoomServer {
  readonly port: number;
  /** What the server has logged so far (joins, leaves, and why it dropped anyone), timestamped. */
  readonly log: readonly string[];
  /** Whether it has been closed. */
  readonly closed: boolean;
  /** Who is in the room with this code, or null if there is no such room. */
  room(code: string): Promise<RoomView | null>;
  /**
   * Start writing down, every tick, whom Chef Skinner in this room winds up to throw at; false if
   * he is not out of its walk-in.
   */
  watchChef(code: string): Promise<boolean>;
  /** Whom he has wound up to throw at since `watchChef`, or null if he was never watched. */
  chefTargets(code: string): Promise<ChefTargets | null>;
  close(): Promise<void>;
}

/** Every room server started in this worker, oldest first, for attaching their logs to a failure. */
export const roomServers: RoomServer[] = [];

const running = new Set<ChildProcess>();
process.once('exit', () => {
  for (const child of running) child.kill();
});

const STARTUP_MS = 15_000;
const CLOSE_MS = 5000;

export function startRoomServer(port = E2E_SERVER_PORT): Promise<RoomServer> {
  const child = fork(resolve(import.meta.dirname, 'roomServerProcess.ts'), [String(port)], {
    // Not the test runner's own loaders: Node runs the server's TypeScript itself, as in dev.
    execArgv: [],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  running.add(child);
  const log: string[] = [];
  const replies = new Map<number, (value: unknown) => void>();
  let nextId = 0;
  let closed = false;
  const exited = new Promise<number | null>((done) => {
    child.once('exit', (code) => {
      running.delete(child);
      closed = true;
      for (const reply of replies.values()) reply(null);
      replies.clear();
      done(code);
    });
  });
  // Anything it prints, a crash above all, goes in the log too, as does a message it can no longer
  // take (its channel closes as it exits), rather than an error nobody listens for.
  child.on('error', (error) => log.push(`room server process: ${String(error)}`));
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding('utf8');
    stream?.on('data', (text: string) => log.push(...text.trimEnd().split('\n')));
  }

  const ask = (kind: 'room' | 'watchChef' | 'chefTargets', code: string): Promise<unknown> =>
    new Promise((answer) => {
      if (closed) return answer(null);
      const id = nextId++;
      replies.set(id, answer);
      child.send({ kind, id, code } satisfies ServerRequest);
    });

  return new Promise((resolveStart, rejectStart) => {
    const timer = setTimeout(() => {
      child.kill();
      rejectStart(new Error(`room server did not start on ${port}:\n${log.join('\n')}`));
    }, STARTUP_MS);
    void exited.then((code) => {
      clearTimeout(timer);
      rejectStart(new Error(`room server exited (${code}) on ${port}:\n${log.join('\n')}`));
    });
    child.on('message', (event: ServerEvent) => {
      switch (event.kind) {
        case 'log':
          log.push(event.line);
          break;
        case 'reply':
          replies.get(event.id)?.(event.value);
          replies.delete(event.id);
          break;
        case 'failed':
          log.push(event.message);
          break;
        case 'ready': {
          clearTimeout(timer);
          const server: RoomServer = {
            port: event.port,
            log,
            get closed() {
              return closed;
            },
            room: (code) => ask('room', code) as Promise<RoomView | null>,
            watchChef: async (code) => (await ask('watchChef', code)) === true,
            chefTargets: (code) => ask('chefTargets', code) as Promise<ChefTargets | null>,
            close: async () => {
              if (!closed) {
                child.send({ kind: 'close' } satisfies ServerRequest);
                const late = setTimeout(() => child.kill(), CLOSE_MS);
                await exited;
                clearTimeout(late);
              }
            },
          };
          roomServers.push(server);
          resolveStart(server);
          break;
        }
      }
    });
  });
}
