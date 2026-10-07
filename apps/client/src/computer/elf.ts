import { NULL_GUARD } from './abi.ts';
import type { Cpu } from './cpu.ts';

/** One loadable segment of an ELF file. */
export interface Segment {
  readonly vaddr: number;
  readonly data: Uint8Array;
  readonly memsz: number;
  readonly executable: boolean;
}

export interface ElfImage {
  readonly entry: number;
  readonly segments: readonly Segment[];
  /** The span of the executable segments: where the CPU may fetch instructions. */
  readonly codeStart: number;
  readonly codeEnd: number;
}

const PT_LOAD = 1;
const PF_X = 1;
const EM_RISCV = 243;
const ET_EXEC = 2;

/**
 * Parses a statically linked little-endian ELF32 RISC-V executable: the header and the
 * PT_LOAD program headers are all a bare-metal loader needs. Sections and symbols are
 * ignored.
 */
export function parseElf(bytes: Uint8Array): ElfImage {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fail = (why: string): never => {
    throw new Error(`not a kitchen computer program: ${why}`);
  };
  if (bytes.length < 52) fail('too short');
  if (view.getUint32(0, false) !== 0x7f454c46) fail('no ELF magic');
  if (bytes[4] !== 1) fail('not 32-bit');
  if (bytes[5] !== 1) fail('not little-endian');
  if (view.getUint16(16, true) !== ET_EXEC) fail('not an executable');
  if (view.getUint16(18, true) !== EM_RISCV) fail('not RISC-V');

  const entry = view.getUint32(24, true);
  const phoff = view.getUint32(28, true);
  const phentsize = view.getUint16(42, true);
  const phnum = view.getUint16(44, true);
  if (phentsize < 32 || phoff + phnum * phentsize > bytes.length) fail('bad program headers');

  const segments: Segment[] = [];
  let codeStart = Infinity;
  let codeEnd = 0;
  for (let i = 0; i < phnum; i++) {
    const at = phoff + i * phentsize;
    if (view.getUint32(at, true) !== PT_LOAD) continue;
    const offset = view.getUint32(at + 4, true);
    const vaddr = view.getUint32(at + 8, true);
    const filesz = view.getUint32(at + 16, true);
    const memsz = view.getUint32(at + 20, true);
    const flags = view.getUint32(at + 24, true);
    if (filesz > memsz || offset + filesz > bytes.length) fail(`bad segment ${i}`);
    const executable = (flags & PF_X) !== 0;
    segments.push({ vaddr, data: bytes.subarray(offset, offset + filesz), memsz, executable });
    if (executable) {
      codeStart = Math.min(codeStart, vaddr);
      codeEnd = Math.max(codeEnd, vaddr + memsz);
    }
  }
  if (codeEnd === 0) fail('no code');
  return { entry, segments, codeStart, codeEnd };
}

/** Copies the image into RAM, zero-fills each segment's tail and points the CPU at it. */
export function loadElf(cpu: Cpu, image: ElfImage): void {
  for (const segment of image.segments) {
    const end = segment.vaddr + segment.memsz;
    if (segment.vaddr < NULL_GUARD || end > cpu.ramSize) {
      throw new Error(`segment at 0x${segment.vaddr.toString(16)} does not fit in RAM`);
    }
    cpu.u8.set(segment.data, segment.vaddr);
    cpu.u8.fill(0, segment.vaddr + segment.data.length, end);
  }
  cpu.setCodeRange(image.codeStart, image.codeEnd);
  cpu.reset(image.entry);
}
