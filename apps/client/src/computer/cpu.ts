import { MMIO_BASE, MMIO_SIZE, NULL_GUARD } from './abi.ts';

/** The memory-mapped registers: 32-bit, word-aligned accesses only. */
export interface Bus {
  read(offset: number): number;
  write(offset: number, value: number): void;
}

/** A guest error the machine cannot continue from: bad address, illegal instruction. */
export class GuestFault extends Error {
  readonly pc: number;

  constructor(message: string, pc: number) {
    super(`${message} (pc ${hex(pc)})`);
    this.name = 'GuestFault';
    this.pc = pc;
  }
}

export function hex(value: number): string {
  return `0x${(value >>> 0).toString(16).padStart(8, '0')}`;
}

/** Why the CPU halted on its own: it ran `ebreak` or `ecall`. */
export type Trap = 'ebreak' | 'ecall';

// Typed-array views read memory in host byte order; RISC-V is little-endian.
if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
  throw new Error('the kitchen computer needs a little-endian host');
}

/**
 * Architectural state of the RV32IM hart and its RAM, shared by both execution engines
 * (the reference interpreter and the JIT). RAM is flat from address 0; the first page is
 * unmapped so null pointers fault, and MMIO sits at MMIO_BASE. The engines inline the
 * common case of every memory access (aligned, in RAM) and call the methods here for
 * everything else.
 */
export class Cpu {
  readonly regs = new Int32Array(32);
  pc = 0;
  /** Instructions retired since reset. */
  instret = 0;
  /** Set by a device (or a trap) to end the current run right after this instruction. */
  stop = false;
  trap: Trap | null = null;

  readonly ramSize: number;
  readonly ram: ArrayBuffer;
  readonly u8: Uint8Array;
  readonly i8: Int8Array;
  readonly u16: Uint16Array;
  readonly i16: Int16Array;
  readonly i32: Int32Array;

  /** Instructions are fetched only from [codeStart, codeEnd). */
  codeStart = NULL_GUARD;
  codeEnd = NULL_GUARD;
  /** Called when a store lands in the code range, so translated code can be dropped. */
  onCodeWrite: (() => void) | null = null;

  bus: Bus;

  constructor(ramSize: number, bus: Bus) {
    if (ramSize % 4096 !== 0 || ramSize > MMIO_BASE) throw new Error('bad RAM size');
    this.ramSize = ramSize;
    this.ram = new ArrayBuffer(ramSize);
    this.u8 = new Uint8Array(this.ram);
    this.i8 = new Int8Array(this.ram);
    this.u16 = new Uint16Array(this.ram);
    this.i16 = new Int16Array(this.ram);
    this.i32 = new Int32Array(this.ram);
    this.bus = bus;
  }

  reset(entry: number): void {
    this.regs.fill(0);
    this.pc = entry;
    this.instret = 0;
    this.stop = false;
    this.trap = null;
  }

  setCodeRange(start: number, end: number): void {
    this.codeStart = start;
    this.codeEnd = end;
    this.onCodeWrite?.();
  }

  /** Lowest address where a store cannot touch code: the engines' fast store path starts here. */
  get storeFloor(): number {
    return Math.max(this.codeEnd, NULL_GUARD);
  }

  private inRam(addr: number, size: number): boolean {
    return (addr - NULL_GUARD) >>> 0 <= this.ramSize - NULL_GUARD - size;
  }

  private mmioOffset(addr: number, pc: number, what: string): number {
    const offset = (addr - MMIO_BASE) >>> 0;
    if (offset >= MMIO_SIZE) throw new GuestFault(`${what} unmapped address ${hex(addr)}`, pc);
    if (offset & 3) throw new GuestFault(`${what} misaligned register ${hex(addr)}`, pc);
    return offset;
  }

  private mmioRead(addr: number, size: number, pc: number): number {
    if (size !== 4) throw new GuestFault(`${size}-byte read of register ${hex(addr)}`, pc);
    return this.bus.read(this.mmioOffset(addr, pc, 'read from')) | 0;
  }

  private mmioWrite(addr: number, value: number, size: number, pc: number): void {
    if (size !== 4) throw new GuestFault(`${size}-byte write to register ${hex(addr)}`, pc);
    this.bus.write(this.mmioOffset(addr, pc, 'write to'), value | 0);
  }

  private wroteCode(addr: number, size: number): void {
    if (addr < this.codeEnd && addr + size > this.codeStart) this.onCodeWrite?.();
  }

  load8(addr: number, pc: number): number {
    if (this.inRam(addr, 1)) return this.i8[addr]!;
    return (this.mmioRead(addr, 1, pc) << 24) >> 24;
  }

  load8u(addr: number, pc: number): number {
    if (this.inRam(addr, 1)) return this.u8[addr]!;
    return this.mmioRead(addr, 1, pc) & 0xff;
  }

  load16(addr: number, pc: number): number {
    return (this.load16u(addr, pc) << 16) >> 16;
  }

  load16u(addr: number, pc: number): number {
    if (this.inRam(addr, 2)) {
      const u8 = this.u8;
      return u8[addr]! | (u8[addr + 1]! << 8);
    }
    return this.mmioRead(addr, 2, pc) & 0xffff;
  }

  load32(addr: number, pc: number): number {
    if (this.inRam(addr, 4)) {
      if ((addr & 3) === 0) return this.i32[addr >> 2]!;
      const u8 = this.u8;
      return u8[addr]! | (u8[addr + 1]! << 8) | (u8[addr + 2]! << 16) | (u8[addr + 3]! << 24);
    }
    return this.mmioRead(addr, 4, pc);
  }

  store8(addr: number, value: number, pc: number): void {
    if (this.inRam(addr, 1)) {
      this.wroteCode(addr, 1);
      this.u8[addr] = value;
      return;
    }
    this.mmioWrite(addr, value, 1, pc);
  }

  store16(addr: number, value: number, pc: number): void {
    if (this.inRam(addr, 2)) {
      this.wroteCode(addr, 2);
      this.u8[addr] = value;
      this.u8[addr + 1] = value >> 8;
      return;
    }
    this.mmioWrite(addr, value, 2, pc);
  }

  store32(addr: number, value: number, pc: number): void {
    if (this.inRam(addr, 4)) {
      this.wroteCode(addr, 4);
      if ((addr & 3) === 0) {
        this.i32[addr >> 2] = value;
      } else {
        const u8 = this.u8;
        u8[addr] = value;
        u8[addr + 1] = value >> 8;
        u8[addr + 2] = value >> 16;
        u8[addr + 3] = value >> 24;
      }
      return;
    }
    this.mmioWrite(addr, value, 4, pc);
  }
}

/**
 * High 32 bits of 64-bit products (MULH, MULHU, MULHSU) without BigInt: the double
 * product is within 2^11 of the exact one, and the low word is exact from Math.imul, so
 * (approximate product - exact low word) / 2^32 rounds to the exact high word.
 */
export function mulh(a: number, b: number): number {
  return Math.round((a * b - (Math.imul(a, b) >>> 0)) / 4294967296) | 0;
}

export function mulhu(a: number, b: number): number {
  return Math.round(((a >>> 0) * (b >>> 0) - (Math.imul(a, b) >>> 0)) / 4294967296) | 0;
}

export function mulhsu(a: number, b: number): number {
  return Math.round((a * (b >>> 0) - (Math.imul(a, b) >>> 0)) / 4294967296) | 0;
}

/** RISC-V division never traps: x / 0 is -1, x % 0 is x, and INT_MIN / -1 wraps. */
export function div(a: number, b: number): number {
  return b === 0 ? -1 : (a / b) | 0;
}

export function divu(a: number, b: number): number {
  return b === 0 ? -1 : ((a >>> 0) / (b >>> 0)) | 0;
}

export function rem(a: number, b: number): number {
  return b === 0 ? a : a % b | 0;
}

export function remu(a: number, b: number): number {
  return b === 0 ? a : (a >>> 0) % (b >>> 0) | 0;
}
