import { fork, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import type { Prefs } from '@world/shared';
import { E2E_SERVER_PORT } from './ports.ts';

/** Who is in a room, as the room server has it. */
export interface RoomView {
  readonly players: readonly { id: number; name: string; prefs: Prefs }[];
}

export type ServerRequest =
  | { readonly kind: 'room'; readonly id: number; readonly code: string }
  | { readonly kind: 'close' };

export type ServerEvent =
  | { readonly kind: 'ready'; readonly port: number }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'log'; readonly line: string }
  | { readonly kind: 'reply'; readonly id: number; readonly value: unknown };

/**
 * The real room server, with Chef Skinner in the lobby as in production, run in a process of its
 * own (roomServerProcess.ts) so it keeps time however busy the test process is, and so tests can
 * stop and restart it.
 */
export interface RoomServer {
  readonly port: number;
  /** What the server has logged so far (joins, leaves, and why it dropped anyone), timestamped. */
  readonly log: readonly string[];
  /** Whether it has been closed. */
  readonly closed: boolean;
  /** Who is in the room with this code, or null if there is no such room. */
  room(code: string): Promise<RoomView | null>;
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
  // Anything it prints, a crash above all, goes in the log too.
  for (const stream of [child.stdout, child.stderr]) {
    stream?.setEncoding('utf8');
    stream?.on('data', (text: string) => log.push(...text.trimEnd().split('\n')));
  }

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
            room: (code) =>
              new Promise((answer) => {
                if (closed) return answer(null);
                const id = nextId++;
                replies.set(id, (value) => answer(value as RoomView | null));
                child.send({ kind: 'room', id, code } satisfies ServerRequest);
              }),
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
