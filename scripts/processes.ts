/**
 * What the dev scripts (perf, screenshots) start beside themselves, and stopping all of it.
 *
 * Each child runs in a process group of its own and is stopped by signalling the whole group, since
 * a child may start processes of its own that a signal to it alone would leave running (npm, for
 * one, does not reliably pass signals on). A Vite left over like that kept serving a client built
 * for the last run's room server, and the next run would quietly use it. Being in their own group,
 * the children do not get the terminal's Ctrl+C, so this passes it on: whatever ends the script, an
 * error, a signal or the end of its work, its children end with it.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const running = new Set<ChildProcess>();
let cleanupInstalled = false;

/** Answers HTTP at all, within a second. */
export async function reachable(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1000) });
    return true;
  } catch {
    return false;
  }
}

/** Waits until `url` answers, failing early if `child`, which should be serving it, exits. */
export async function waitFor(url: string, timeoutMs: number, child?: ChildProcess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await reachable(url))) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) {
      throw new Error(
        `${url} did not come up: its process exited (${child.exitCode ?? child.signalCode})`,
      );
    }
    if (Date.now() > deadline) throw new Error(`${url} did not come up`);
    await new Promise((r) => setTimeout(r, 300));
  }
}

/** Starts a command in a process group of its own, to be stopped with everything it starts. */
export function start(
  command: string,
  args: readonly string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): ChildProcess {
  installCleanup();
  const child = spawn(command, args, {
    cwd: options.cwd ?? root,
    stdio: 'ignore',
    detached: true,
    env: { ...process.env, ...options.env },
  });
  running.add(child);
  return child;
}

/** The Vite dev client on `port`, talking to the room server at `serverUrl`; Vite itself, no npm. */
export function startClient(port: number, serverUrl: string): ChildProcess {
  const vite = resolve(
    dirname(createRequire(import.meta.url).resolve('vite/package.json')),
    'bin/vite.js',
  );
  return start(process.execPath, [vite, '--port', String(port), '--strictPort'], {
    cwd: resolve(root, 'apps/client'),
    env: { VITE_SERVER_URL: serverUrl },
  });
}

/** Stops everything started here: asks each process group to end, then kills whatever is left. */
export async function stopAll(): Promise<void> {
  const children = [...running];
  running.clear();
  for (const child of children) signalGroup(child, 'SIGTERM');
  await Promise.all(children.map((child) => exited(child, 3000)));
  for (const child of children) signalGroup(child, 'SIGKILL');
}

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    // The whole group is gone already.
  }
}

function exited(child: ChildProcess, timeoutMs: number): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((done) => {
    const timer = setTimeout(done, timeoutMs);
    child.once('exit', () => {
      clearTimeout(timer);
      done();
    });
  });
}

function installCleanup(): void {
  if (cleanupInstalled) return;
  cleanupInstalled = true;
  const codes = { SIGHUP: 129, SIGINT: 130, SIGTERM: 143 } as const;
  for (const [signal, code] of Object.entries(codes)) {
    process.once(signal, () => {
      // Whatever was under way fails as its browser and servers go: that is the interruption itself,
      // not an error to report, and the script ends once its children have.
      process.on('uncaughtException', () => {});
      void stopAll().finally(() => process.exit(code));
    });
  }
  // The last word, should the script exit without stopping them (process.exit, a crash).
  process.once('exit', () => {
    for (const child of running) signalGroup(child, 'SIGKILL');
  });
}
