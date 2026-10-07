import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as A from './asm.ts';
import { Cpu } from './cpu.ts';
import { loadElf, parseElf } from './elf.ts';
import { CODE, DATA, makeElf, TestBus } from './testRig.ts';

describe('the ELF loader', () => {
  it('loads code and data, zero-fills .bss and starts at the entry point', () => {
    const elf = makeElf([A.addi(1, 0, 1), A.addi(2, 0, 2)], {
      entry: CODE + 4,
      data: new Uint8Array([1, 2, 3]),
      bss: 5,
    });
    const image = parseElf(elf);
    expect(image.entry).toBe(CODE + 4);
    expect(image.codeStart).toBe(CODE);
    expect(image.codeEnd).toBe(CODE + 8);
    expect(image.segments.map((s) => [s.vaddr, s.data.length, s.memsz, s.executable])).toEqual([
      [CODE, 8, 8, true],
      [DATA, 3, 8, false],
    ]);

    const cpu = new Cpu(0x10000, new TestBus());
    cpu.u8.fill(0xee, DATA, DATA + 16);
    cpu.regs[5] = 9;
    loadElf(cpu, image);
    expect(cpu.i32[CODE >> 2]).toBe(A.addi(1, 0, 1) | 0);
    expect([...cpu.u8.subarray(DATA, DATA + 9)]).toEqual([1, 2, 3, 0, 0, 0, 0, 0, 0xee]);
    expect(cpu.pc).toBe(CODE + 4);
    expect(cpu.regs[5]).toBe(0);
  });

  it('rejects what is not a RISC-V executable', () => {
    const good = makeElf([A.ebreak()]);
    const broken = (patch: (b: Uint8Array) => void) => {
      const copy = good.slice();
      patch(copy);
      return () => parseElf(copy);
    };
    expect(() => parseElf(good.subarray(0, 20))).toThrow(/too short/);
    expect(broken((b) => (b[0] = 0))).toThrow(/magic/);
    expect(broken((b) => (b[4] = 2))).toThrow(/32-bit/);
    expect(broken((b) => (b[5] = 2))).toThrow(/little-endian/);
    expect(broken((b) => (b[16] = 3))).toThrow(/executable/);
    expect(broken((b) => (b[18] = 62))).toThrow(/RISC-V/);
    expect(broken((b) => (b[52 + 16] = 0xff))).toThrow(/segment/);
    expect(broken((b) => (b[52 + 24] = 6))).toThrow(/no code/);
  });

  it('refuses segments outside RAM or in the null page', () => {
    const cpu = new Cpu(0x10000, new TestBus());
    expect(() => loadElf(cpu, parseElf(makeElf([0], { data: new Uint8Array(4), dataAddr: 0x10 })))).toThrow(
      /does not fit/,
    );
    expect(() =>
      loadElf(cpu, parseElf(makeElf([0], { data: new Uint8Array(4), dataAddr: 0xfffe }))),
    ).toThrow(/does not fit/);
  });

  it('reads the DOOM firmware', () => {
    const image = parseElf(readFileSync(join(import.meta.dirname, 'assets', 'doom.elf')));
    expect(image.entry).toBe(CODE);
    expect(image.codeStart).toBe(CODE);
    expect(image.codeEnd).toBeGreaterThan(0x40000);
    expect(image.segments.filter((s) => s.executable)).toHaveLength(1);
  });
});
