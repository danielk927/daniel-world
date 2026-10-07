import { FB_HEIGHT, FB_WIDTH } from './abi.ts';
import programUrl from './assets/doom.elf?url';
import diskUrl from './assets/doom1.wad?url';
import { DOOM_KEYS } from './keys.ts';
import type { Engine } from './machine.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

export interface DoomScreen {
  /** 320x200 RGBA, rewritten in place when a new frame arrives. */
  readonly pixels: Uint8ClampedArray;
  readonly width: 320;
  readonly height: 200;
}

export type ComputerState = 'off' | 'booting' | 'running' | 'paused' | 'failed';

export interface KitchenComputerOptions {
  /** Extra DOOM command-line arguments, e.g. "-skill 1" or "-warp 1 2". */
  args?: string;
  /** For tests: makes the worker. */
  createWorker?: () => Worker;
}

/** The worker's side of the conversation, as far as this class needs it. */
type Port = Pick<Worker, 'postMessage' | 'terminate'> & {
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
};

/**
 * The computer in the corner of the kitchen, from the main thread: a RISC-V machine running
 * DOOM in a Web Worker (see machine.ts). Nothing is downloaded or started until the first
 * powerOn(). Frames arrive as RGBA in `screen.pixels`; the frame buffers shuttle between
 * the threads by transfer, so receiving one costs a 256 kB copy and no allocation.
 */
export class KitchenComputer {
  readonly screen: DoomScreen = {
    pixels: new Uint8ClampedArray(FB_WIDTH * FB_HEIGHT * 4),
    width: 320,
    height: 200,
  };

  private currentState: ComputerState = 'off';
  private engineInUse: Engine | null = null;
  private failure: string | null = null;
  private worker: Port | null = null;
  private booting: Promise<void> | null = null;
  private settleBoot: { resolve: () => void; reject: (error: Error) => void } | null = null;
  private pauseAfterBoot = false;
  private frameCallback: ((screen: DoomScreen) => void) | null = null;
  private consoleCallback: ((line: string) => void) | null = null;
  /** Codes held down, to drop auto-repeat; and how many hold each DOOM key (W and Up are one). */
  private readonly held = new Set<string>();
  private readonly holding = new Uint8Array(256);
  private readonly options: KitchenComputerOptions;

  constructor(options: KitchenComputerOptions = {}) {
    this.options = options;
  }

  get state(): ComputerState {
    return this.currentState;
  }

  /** Which engine the machine runs on, once booted: the JIT, or the interpreter under a strict CSP. */
  get engine(): Engine | null {
    return this.engineInUse;
  }

  /** Why the machine failed, when it did. */
  get error(): string | null {
    return this.failure;
  }

  /** Boots on the first call (fetches the binary and WAD, starts the worker); later calls resume. */
  powerOn(): Promise<void> {
    switch (this.currentState) {
      case 'running':
        return Promise.resolve();
      case 'paused':
        this.post({ type: 'run' });
        this.currentState = 'running';
        return Promise.resolve();
      case 'booting':
        this.pauseAfterBoot = false;
        return this.booting!;
      default:
        return this.boot();
    }
  }

  /** Pauses the worker's emulation (the machine keeps its state) so it costs nothing while nobody plays. */
  pause(): void {
    if (this.currentState === 'booting') {
      this.pauseAfterBoot = true;
      return;
    }
    if (this.currentState !== 'running') return;
    this.releaseKeys();
    this.post({ type: 'pause' });
    this.currentState = 'paused';
  }

  /** Key events while someone is using the computer, as KeyboardEvent.code values. */
  key(code: string, down: boolean): void {
    const mapped = DOOM_KEYS[code];
    if (!mapped || this.currentState !== 'running') return;
    if (down === this.held.has(code)) return; // auto-repeat, or a release we never saw pressed
    if (down) this.held.add(code);
    else this.held.delete(code);
    const count = this.holding[mapped.key]!;
    this.holding[mapped.key] = down ? count + 1 : count - 1;
    // Another key held for the same DOOM key keeps it down.
    if ((down && count === 0) || (!down && count === 1)) {
      this.post({ type: 'key', key: mapped.key, typed: mapped.typed, down });
    }
  }

  /** Called on the main thread with each new frame. */
  onFrame(callback: (screen: DoomScreen) => void): void {
    this.frameCallback = callback;
  }

  /** Lines DOOM prints on the machine's debug console (startup messages, errors). */
  onConsole(callback: (line: string) => void): void {
    this.consoleCallback = callback;
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.held.clear();
    this.holding.fill(0);
    this.settleBoot?.reject(new Error('the computer was disposed'));
    this.settleBoot = null;
    this.booting = null;
    this.pauseAfterBoot = false;
    this.currentState = 'off';
  }

  private boot(): Promise<void> {
    this.dispose();
    this.failure = null;
    this.currentState = 'booting';
    const worker = (this.options.createWorker?.() ??
      new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })) as Port;
    this.worker = worker;
    // Messages a terminated worker had already queued must not steer its successor.
    worker.onmessage = (event) => {
      if (this.worker === worker) this.receive(event.data);
    };
    worker.onerror = (event) => {
      if (this.worker === worker) this.fail(event.message || 'the worker failed to start');
    };
    this.booting = new Promise<void>((resolve, reject) => {
      this.settleBoot = { resolve, reject };
    });
    // The worker resolves URLs against its own script, so hand it absolute ones.
    this.post({
      type: 'boot',
      programUrl: new URL(programUrl, location.href).href,
      diskUrl: new URL(diskUrl, location.href).href,
      args: this.options.args ?? '',
    });
    return this.booting;
  }

  private receive(message: FromWorker): void {
    if (message instanceof Uint8ClampedArray) {
      this.screen.pixels.set(message);
      // Straight back, so the worker can fill it with the next frame.
      this.worker?.postMessage(message, [message.buffer]);
      this.frameCallback?.(this.screen);
      return;
    }
    switch (message.type) {
      case 'running':
        this.engineInUse = message.engine;
        this.currentState = 'running';
        this.settleBoot?.resolve();
        this.settleBoot = null;
        if (this.pauseAfterBoot) {
          this.pauseAfterBoot = false;
          this.pause();
        }
        break;
      case 'failed':
        this.fail(message.message);
        break;
      case 'console':
        this.consoleCallback?.(message.line);
        break;
    }
  }

  private fail(message: string): void {
    this.failure = message;
    this.worker?.terminate();
    this.worker = null;
    this.currentState = 'failed';
    this.settleBoot?.reject(new Error(message));
    this.settleBoot = null;
    this.booting = null;
    this.pauseAfterBoot = false;
  }

  private post(message: ToWorker): void {
    this.worker?.postMessage(message);
  }

  private releaseKeys(): void {
    for (const code of [...this.held]) this.key(code, false);
  }
}
