import {
  DISK_BASE,
  DISK_MAX,
  FB_HEIGHT,
  FB_WIDTH,
  MMIO_ARGS,
  MMIO_CONSOLE,
  MMIO_DISK_ADDR,
  MMIO_DISK_SIZE,
  MMIO_EXIT,
  MMIO_FB_ADDR,
  MMIO_FB_PRESENT,
  MMIO_KEY,
  MMIO_KEY_PRESSED,
  MMIO_PALETTE,
  MMIO_SLEEP_MS,
  MMIO_TIME_MS,
  NULL_GUARD,
  RAM_SIZE,
} from './abi.ts';
import type { Bus } from './cpu.ts';
import { Cpu, GuestFault } from './cpu.ts';
import { loadElf, parseElf } from './elf.ts';
import { interpret } from './interpreter.ts';
import { Jit } from './jit.ts';

export type Engine = 'jit' | 'interpreter';

/**
 * Why `run` returned: it used its budget, the guest went to sleep, presented a frame,
 * powered off, or trapped (ebreak or ecall).
 */
export type RunResult = 'budget' | 'sleep' | 'frame' | 'exit' | 'trap';

export interface MachineOptions {
  engine?: Engine;
  ramSize?: number;
  /**
   * Guest time in milliseconds. Without one the machine keeps virtual time, which only
   * moves when the guest sleeps: as if the CPU were infinitely fast, and fully
   * deterministic (tests and benchmarks).
   */
  clock?: () => number;
  /** Lines the guest prints on the debug console. */
  console?: (line: string) => void;
}

const FRAME_PIXELS = FB_WIDTH * FB_HEIGHT;
const KEY_QUEUE = 64;

/**
 * The kitchen computer: the CPU plus its devices (console, timer, keyboard, disk,
 * display), wired up as machine.h describes. Pure TypeScript with no DOM, so it runs the
 * same in a Web Worker, in Node and in tests.
 */
export class Machine implements Bus {
  readonly cpu: Cpu;
  readonly engine: Engine;
  private readonly jit: Jit | null;
  private readonly clock: (() => number) | null;
  private readonly consoleOut: ((line: string) => void) | null;
  private consoleLine = '';
  private virtualTime = 0;

  private program: Uint8Array | null = null;
  private disk: Uint8Array | null = null;
  private args = '';
  private argsAddr = 0;

  /** The status the guest powered off with, or null while it runs. */
  exitCode: number | null = null;
  /** Guest time the CPU sleeps until. */
  sleepUntil = 0;
  private result: RunResult = 'budget';

  private readonly keys = new Uint32Array(KEY_QUEUE);
  private keyHead = 0;
  private keyCount = 0;

  private fbAddr = 0;
  /** The palette as RGBA pixels (little-endian 0xAABBGGRR). */
  private readonly palette = new Uint32Array(256);
  /** The last presented frame, RGBA. */
  readonly screen = new Uint32Array(FRAME_PIXELS);
  readonly screenBytes = new Uint8ClampedArray(this.screen.buffer);
  /** The last presented frame as palette indices. */
  readonly indices = new Uint8Array(FRAME_PIXELS);
  frames = 0;

  constructor(options: MachineOptions = {}) {
    this.engine = options.engine ?? 'jit';
    this.clock = options.clock ?? null;
    this.consoleOut = options.console ?? null;
    this.cpu = new Cpu(options.ramSize ?? RAM_SIZE, this);
    this.jit = this.engine === 'jit' ? new Jit(this.cpu) : null;
  }

  /** Statistics of the translator, when the machine uses it. */
  get jitStats(): Jit['stats'] | null {
    return this.jit?.stats ?? null;
  }

  /**
   * Powers on (or reboots) with a program, a disk image and extra command-line
   * arguments for it: RAM is cleared, the ELF loaded, the disk copied to its window.
   */
  boot(program: Uint8Array, disk: Uint8Array | null = null, args = ''): void {
    const image = parseElf(program);
    const argsBytes = new TextEncoder().encode(args);
    const diskSize = disk?.length ?? 0;
    const argsAddr = argsBytes.length ? DISK_BASE + ((diskSize + 3) & ~3) : 0;
    if (diskSize + argsBytes.length + 4 > DISK_MAX) throw new Error('disk image too large');
    if ((disk || argsAddr) && DISK_BASE + DISK_MAX > this.cpu.ramSize) {
      throw new Error('RAM too small for a disk');
    }

    this.program = program;
    this.disk = disk;
    this.args = args;
    const cpu = this.cpu;
    cpu.u8.fill(0);
    if (disk) cpu.u8.set(disk, DISK_BASE);
    if (argsAddr) cpu.u8.set(argsBytes, argsAddr);
    this.argsAddr = argsAddr;
    loadElf(cpu, image);

    this.exitCode = null;
    this.sleepUntil = 0;
    this.virtualTime = 0;
    this.keyHead = 0;
    this.keyCount = 0;
    this.fbAddr = 0;
    this.palette.fill(0xff000000);
    this.consoleLine = '';
  }

  /** Boots again with the same program, disk and arguments. */
  reboot(): void {
    if (!this.program) throw new Error('nothing to reboot');
    this.boot(this.program, this.disk, this.args);
  }

  now(): number {
    return this.clock ? this.clock() : this.virtualTime;
  }

  get sleeping(): boolean {
    return this.exitCode === null && this.now() < this.sleepUntil;
  }

  /**
   * Runs the CPU for up to `budget` instructions (the JIT may overshoot by a block).
   * Returns early when the guest sleeps, presents a frame, powers off or traps. Throws
   * GuestFault when the program crashes.
   */
  run(budget: number): RunResult {
    const cpu = this.cpu;
    if (this.exitCode !== null) return 'exit';
    if (cpu.trap) return 'trap';
    if (this.sleeping) return 'sleep';
    cpu.stop = false;
    this.result = 'budget';
    if (this.jit) this.jit.run(budget);
    else interpret(cpu, budget);
    if (cpu.trap) return 'trap';
    return this.result;
  }

  /** Queues a key event; `typed` is the unshifted character the key types, or 0. */
  key(doomKey: number, pressed: boolean, typed = 0): void {
    const event = (typed << 16) | (pressed ? MMIO_KEY_PRESSED : 0) | (doomKey & 0xff);
    if (this.keyCount === KEY_QUEUE) {
      // A full queue drops presses, never releases: a lost release leaves a key held
      // down. To make room for one, give up the oldest press.
      if (pressed || !this.dropOldestPress()) return;
    }
    this.keys[(this.keyHead + this.keyCount) % KEY_QUEUE] = event;
    this.keyCount++;
  }

  private dropOldestPress(): boolean {
    const keys = this.keys;
    for (let k = 0; k < this.keyCount; k++) {
      if (!(keys[(this.keyHead + k) % KEY_QUEUE]! & MMIO_KEY_PRESSED)) continue;
      for (let j = k; j < this.keyCount - 1; j++) {
        keys[(this.keyHead + j) % KEY_QUEUE] = keys[(this.keyHead + j + 1) % KEY_QUEUE]!;
      }
      this.keyCount--;
      return true;
    }
    return false;
  }

  read(offset: number): number {
    switch (offset) {
      case MMIO_TIME_MS:
        return Math.floor(this.now()) | 0;
      case MMIO_KEY: {
        if (this.keyCount === 0) return 0;
        const event = this.keys[this.keyHead]!;
        this.keyHead = (this.keyHead + 1) % KEY_QUEUE;
        this.keyCount--;
        return event;
      }
      case MMIO_DISK_ADDR:
        return this.disk ? DISK_BASE : 0;
      case MMIO_DISK_SIZE:
        return this.disk?.length ?? 0;
      case MMIO_ARGS:
        return this.argsAddr;
      default:
        return 0;
    }
  }

  write(offset: number, value: number, pc: number): void {
    const cpu = this.cpu;
    switch (offset) {
      case MMIO_CONSOLE:
        this.putchar(value & 0xff);
        return;
      case MMIO_EXIT:
        this.flushConsole();
        this.exitCode = value;
        this.result = 'exit';
        cpu.stop = true;
        return;
      case MMIO_SLEEP_MS:
        if (this.clock) {
          this.sleepUntil = this.now() + (value >>> 0);
          this.result = 'sleep';
          cpu.stop = true;
        } else {
          // Virtual time: the sleep is over as soon as it starts.
          this.virtualTime += value >>> 0;
        }
        return;
      case MMIO_FB_ADDR:
        this.fbAddr = value >>> 0;
        return;
      case MMIO_FB_PRESENT:
        this.present(pc);
        return;
      default:
        if (offset >= MMIO_PALETTE && offset < MMIO_PALETTE + 1024) {
          const r = (value >> 16) & 0xff;
          const g = (value >> 8) & 0xff;
          const b = value & 0xff;
          this.palette[(offset - MMIO_PALETTE) >> 2] = 0xff000000 | (b << 16) | (g << 8) | r;
        }
    }
  }

  /** Scans the frame out of RAM through the palette, like a display controller would. */
  private present(pc: number): void {
    const cpu = this.cpu;
    const base = this.fbAddr;
    if (base < NULL_GUARD || base + FRAME_PIXELS > cpu.ramSize) {
      throw new GuestFault(`frame outside RAM at 0x${base.toString(16)}`, pc);
    }
    const ram = cpu.u8;
    const palette = this.palette;
    const screen = this.screen;
    const indices = this.indices;
    for (let i = 0; i < FRAME_PIXELS; i++) {
      const index = ram[base + i]!;
      indices[i] = index;
      screen[i] = palette[index]!;
    }
    this.frames++;
    this.result = 'frame';
    cpu.stop = true;
  }

  private putchar(c: number): void {
    if (c === 10) this.flushConsole();
    else this.consoleLine += String.fromCharCode(c);
  }

  private flushConsole(): void {
    if (this.consoleLine && this.consoleOut) this.consoleOut(this.consoleLine);
    this.consoleLine = '';
  }
}
