/**
 * The kitchen computer's Web Worker: owns the Machine and runs it in real time, off the
 * main thread. Guest time is wall time accumulated while running, so a paused machine
 * resumes where it left off instead of racing to catch up.
 */

import { FB_HEIGHT, FB_WIDTH } from './abi.ts';
import type { Engine } from './machine.ts';
import { Machine } from './machine.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

interface WorkerScope {
  postMessage(message: FromWorker, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<ToWorker>) => void) | null;
}
const scope = globalThis as unknown as WorkerScope;

/** Run in slices this long, then yield so key presses and pauses get through. */
const SLICE_MS = 8;
/** Instructions per Machine.run call: well under a slice even for the interpreter. */
const BUDGET = 500_000;
const FRAME_BYTES = FB_WIDTH * FB_HEIGHT * 4;

// The translator compiles with `new Function`; a Content-Security-Policy without
// 'unsafe-eval' forbids that, and then the interpreter has to do.
const engine: Engine = (() => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return (new Function('return 1') as () => unknown)() === 1 ? 'jit' : 'interpreter';
  } catch {
    return 'interpreter';
  }
})();

let machine: Machine | null = null;
let running = false;
let guestBase = 0;
let wallBase = 0;
const clock = () => (running ? guestBase + (performance.now() - wallBase) : guestBase);

function setRunning(on: boolean): void {
  if (on === running) return;
  if (on) wallBase = performance.now();
  else guestBase = clock();
  running = on;
}

// Frame buffers not in flight to the main thread.
const spares = [new Uint8ClampedArray(FRAME_BYTES), new Uint8ClampedArray(FRAME_BYTES)];
let framePending = false;

function sendFrame(): void {
  const buffer = spares.pop();
  if (!buffer || !machine) {
    framePending = true;
    return;
  }
  framePending = false;
  buffer.set(machine.screenBytes);
  scope.postMessage(buffer, [buffer.buffer]);
}

// Zero-delay yields go through a MessageChannel: setTimeout(0) is clamped to 4 ms once
// timeouts nest. Timed waits post to the channel when they fire for the same reason.
const channel = new MessageChannel();
let yieldQueued = false;
let timer: ReturnType<typeof setTimeout> | undefined;

function wake(): void {
  if (yieldQueued) return;
  yieldQueued = true;
  channel.port2.postMessage(null);
}

function schedule(delayMs: number): void {
  clearTimeout(timer);
  timer = undefined;
  if (delayMs <= 0) wake();
  else timer = setTimeout(wake, delayMs);
}

channel.port1.onmessage = () => {
  yieldQueued = false;
  step();
};

function step(): void {
  if (!running || !machine) return;
  const deadline = performance.now() + SLICE_MS;
  try {
    for (;;) {
      const result = machine.run(BUDGET);
      if (result === 'frame') {
        sendFrame();
      } else if (result === 'sleep') {
        schedule(machine.sleepUntil - clock());
        return;
      } else if (result === 'exit') {
        // Quitting DOOM powers the machine off; like a kiosk, it starts again.
        machine.reboot();
      } else if (result === 'trap') {
        throw new Error(`the CPU stopped at ${machine.cpu.trap}`);
      }
      if (performance.now() >= deadline) {
        schedule(0);
        return;
      }
    }
  } catch (error) {
    fail(error);
  }
}

function fail(error: unknown): void {
  setRunning(false);
  machine = null;
  scope.postMessage({
    type: 'failed',
    message: error instanceof Error ? error.message : String(error),
  });
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status} ${response.statusText}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function boot(programUrl: string, diskUrl: string, args: string): Promise<void> {
  const [program, disk] = await Promise.all([fetchBytes(programUrl), fetchBytes(diskUrl)]);
  machine = new Machine({
    engine,
    clock,
    console: (line) => scope.postMessage({ type: 'console', line }),
  });
  machine.boot(program, disk, args);
  guestBase = 0;
  setRunning(true);
  scope.postMessage({ type: 'running', engine });
  schedule(0);
}

scope.onmessage = (event) => {
  const message = event.data;
  if (message instanceof Uint8ClampedArray) {
    spares.push(message);
    if (framePending) sendFrame();
    return;
  }
  switch (message.type) {
    case 'boot':
      boot(message.programUrl, message.diskUrl, message.args).catch(fail);
      break;
    case 'run':
      if (machine) {
        setRunning(true);
        schedule(0);
      }
      break;
    case 'pause':
      setRunning(false);
      clearTimeout(timer);
      timer = undefined;
      break;
    case 'key':
      machine?.key(message.key, message.down, message.typed);
      break;
  }
};
