/** Shared scaffolding for the computer's tests: a CPU with a program in it, both engines. */

import { NULL_GUARD } from './abi.ts';
import type { Bus } from './cpu.ts';
import { Cpu } from './cpu.ts';
import { ebreak } from './asm.ts';
import { interpret } from './interpreter.ts';
import { Jit } from './jit.ts';

export type EngineName = 'interpreter' | 'jit';
export const ENGINES: readonly EngineName[] = ['interpreter', 'jit'];

export const CODE = NULL_GUARD;
export const DATA = 0x8000;
export const TEST_RAM = 0x10000;

/** Registers that remember what was written and answer reads from a table. */
export class TestBus implements Bus {
  readonly writes: [number, number][] = [];
  readonly reads: number[] = [];
  readonly values = new Map<number, number>();
  /** Offsets whose write stops the CPU, like the machine's sleep and present registers. */
  readonly stopping = new Set<number>();
  cpu: Cpu | null = null;

  read(offset: number): number {
    this.reads.push(offset);
    return this.values.get(offset) ?? 0;
  }

  write(offset: number, value: number): void {
    this.writes.push([offset, value]);
    if (this.stopping.has(offset) && this.cpu) this.cpu.stop = true;
  }
}

/** A CPU with `words` at CODE (followed by an ebreak) and the code range set to cover them. */
export function makeCpu(words: readonly number[], bus = new TestBus()): Cpu {
  const cpu = new Cpu(TEST_RAM, bus);
  bus.cpu = cpu;
  const program = [...words, ebreak()];
  program.forEach((word, k) => (cpu.i32[(CODE >> 2) + k] = word));
  cpu.setCodeRange(CODE, CODE + program.length * 4);
  cpu.reset(CODE);
  return cpu;
}

const jits = new WeakMap<Cpu, Jit>();

/** Runs `cpu` on one engine until it traps or stops, or `budget` instructions retire. */
export function execute(cpu: Cpu, engine: EngineName, budget = 1_000_000): number {
  cpu.stop = false;
  if (engine === 'interpreter') return interpret(cpu, budget);
  let jit = jits.get(cpu);
  if (!jit) {
    jit = new Jit(cpu);
    jits.set(cpu, jit);
  }
  return jit.run(budget);
}

/** Assembles, runs to the final ebreak and returns the CPU. */
export function run(words: readonly number[], engine: EngineName, setup?: (cpu: Cpu) => void): Cpu {
  const cpu = makeCpu(words);
  setup?.(cpu);
  execute(cpu, engine);
  return cpu;
}

/** A minimal ELF32 RISC-V executable: one RX segment of code, optionally one RW segment. */
export function makeElf(
  code: readonly number[],
  options: { entry?: number; data?: Uint8Array; dataAddr?: number; bss?: number } = {},
): Uint8Array {
  const segments = options.data || options.bss ? 2 : 1;
  const header = 52 + 32 * segments;
  const codeBytes = code.length * 4;
  const dataBytes = options.data?.length ?? 0;
  const bytes = new Uint8Array(header + codeBytes + dataBytes);
  const view = new DataView(bytes.buffer);
  bytes.set([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1]);
  view.setUint16(16, 2, true); // ET_EXEC
  view.setUint16(18, 243, true); // EM_RISCV
  view.setUint32(20, 1, true);
  view.setUint32(24, options.entry ?? CODE, true);
  view.setUint32(28, 52, true); // phoff
  view.setUint16(40, 52, true);
  view.setUint16(42, 32, true);
  view.setUint16(44, segments, true);
  const segment = (k: number, offset: number, vaddr: number, filesz: number, memsz: number, flags: number) => {
    const at = 52 + 32 * k;
    view.setUint32(at, 1, true); // PT_LOAD
    view.setUint32(at + 4, offset, true);
    view.setUint32(at + 8, vaddr, true);
    view.setUint32(at + 12, vaddr, true);
    view.setUint32(at + 16, filesz, true);
    view.setUint32(at + 20, memsz, true);
    view.setUint32(at + 24, flags, true);
    view.setUint32(at + 28, 4, true);
  };
  segment(0, header, CODE, codeBytes, codeBytes, 5);
  code.forEach((word, k) => view.setUint32(header + k * 4, word, true));
  if (segments === 2) {
    segment(1, header + codeBytes, options.dataAddr ?? DATA, dataBytes, dataBytes + (options.bss ?? 0), 6);
    if (options.data) bytes.set(options.data, header + codeBytes);
  }
  return bytes;
}

/** A small deterministic PRNG (mulberry32) for the differential tests. */
export function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
