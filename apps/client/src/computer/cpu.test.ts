import { describe, expect, it } from 'vitest';
import { createRandom } from '@world/shared';
import * as A from './asm.ts';
import { GuestFault, mulh, mulhsu, mulhu } from './cpu.ts';
import { CODE, DATA, ENGINES, execute, makeCpu, run, TestBus } from './testRig.ts';

const INT_MIN = -0x80000000;

describe('64-bit products without BigInt', () => {
  it('match BigInt arithmetic on edge cases and random operands', () => {
    const values = [
      0,
      1,
      -1,
      2,
      -2,
      INT_MIN,
      0x7fffffff,
      0x10000,
      -0x10000,
      0x12345678,
      -0x6789abcd,
    ];
    // Seeded, so a failure comes back on every run, with the same operands.
    const random = createRandom(0x6d756c68);
    for (let k = 0; k < 2000; k++) values.push((random() * 2 ** 32) | 0);
    const high = (product: bigint) => Number(BigInt.asIntN(32, product >> 32n));
    for (let k = 0; k < values.length; k++) {
      const a = values[k]!;
      const b = values[(k * 7 + 3) % values.length]!;
      expect(mulh(a, b)).toBe(high(BigInt(a) * BigInt(b)));
      expect(mulhu(a, b)).toBe(high(BigInt(a >>> 0) * BigInt(b >>> 0)));
      expect(mulhsu(a, b)).toBe(high(BigInt(a) * BigInt(b >>> 0)));
    }
  });
});

describe.each(ENGINES)('RV32IM on the %s', (engine) => {
  /** Runs `body` after loading registers x1.. with `inputs`; returns the register file. */
  const exec = (inputs: number[], body: number[]) =>
    run(body, engine, (cpu) => inputs.forEach((v, k) => (cpu.regs[k + 1] = v))).regs;

  it('adds, subtracts and compares with 32-bit wraparound', () => {
    const r = exec(
      [0x7fffffff, 1, -1],
      [
        A.add(10, 1, 2),
        A.sub(11, 0, 1),
        A.sub(12, 10, 2),
        A.slt(13, 3, 2),
        A.sltu(14, 3, 2),
        A.slti(15, 3, 0),
        A.sltiu(16, 2, -1),
        A.sltiu(17, 3, -1),
        A.addi(18, 2, -2048),
        A.xori(19, 1, -1),
        A.ori(20, 0, 0x7ff),
        A.andi(21, 3, 0x0f0),
        A.xor(22, 1, 3),
        A.or(23, 1, 2),
        A.and(24, 1, 3),
      ],
    );
    expect(r[10]).toBe(INT_MIN);
    expect(r[11]).toBe(-0x7fffffff);
    expect(r[12]).toBe(0x7fffffff);
    expect(r[13]).toBe(1);
    expect(r[14]).toBe(0);
    expect(r[15]).toBe(1);
    // SLTIU sign-extends its immediate, then compares unsigned: 1 < 0xffffffff.
    expect(r[16]).toBe(1);
    expect(r[17]).toBe(0);
    expect(r[18]).toBe(-2047);
    expect(r[19]).toBe(INT_MIN);
    expect(r[20]).toBe(0x7ff);
    expect(r[21]).toBe(0x0f0);
    expect(r[22]).toBe(INT_MIN);
    expect(r[23]).toBe(0x7fffffff);
    expect(r[24]).toBe(0x7fffffff);
  });

  it('shifts by register using only the low five bits', () => {
    const r = exec(
      [INT_MIN | 0x10, 33, 31, 0, 32],
      [
        A.sll(10, 1, 2),
        A.srl(11, 1, 2),
        A.sra(12, 1, 2),
        A.sll(13, 1, 3),
        A.srl(14, 1, 3),
        A.sra(15, 1, 3),
        A.sra(16, 1, 4),
        A.srl(17, 1, 5),
        A.slli(18, 1, 31),
        A.srli(19, 1, 31),
        A.srai(20, 1, 31),
        A.srai(21, 1, 4),
      ],
    );
    expect(r[10]).toBe(0x20);
    expect(r[11]).toBe(0x40000008);
    expect(r[12]).toBe(-0x3ffffff8);
    expect(r[13]).toBe(0);
    expect(r[14]).toBe(1);
    expect(r[15]).toBe(-1);
    expect(r[16]).toBe(INT_MIN | 0x10);
    expect(r[17]).toBe(INT_MIN | 0x10);
    expect(r[18]).toBe(0);
    expect(r[19]).toBe(1);
    expect(r[20]).toBe(-1);
    expect(r[21]).toBe(-0x07ffffff);
  });

  it('builds constants with LUI and AUIPC', () => {
    const r = exec(
      [],
      [A.lui(10, 0xfffff000), A.auipc(11, 0x1000), ...A.li(12, -1), ...A.li(13, 0x12345fff)],
    );
    expect(r[10]).toBe(-4096);
    expect(r[11]).toBe(CODE + 4 + 0x1000);
    expect(r[12]).toBe(-1);
    expect(r[13]).toBe(0x12345fff);
  });

  it('multiplies, including the high halves', () => {
    const r = exec(
      [-1, INT_MIN, 0x7fffffff, 3],
      [
        A.mul(10, 2, 2),
        A.mulh(11, 1, 1),
        A.mulh(12, 2, 2),
        A.mulhu(13, 1, 1),
        A.mulhsu(14, 1, 1),
        A.mulhsu(15, 2, 1),
        A.mul(16, 3, 4),
        A.mulh(17, 3, 4),
        A.mulhu(18, 2, 4),
      ],
    );
    expect(r[10]).toBe(0);
    expect(r[11]).toBe(0);
    expect(r[12]).toBe(0x40000000);
    expect(r[13]).toBe(-2);
    expect(r[14]).toBe(-1);
    expect(r[15]).toBe(INT_MIN);
    expect(r[16]).toBe(0x7ffffffd);
    expect(r[17]).toBe(1);
    expect(r[18]).toBe(1);
  });

  it('divides without trapping on zero or overflow', () => {
    const r = exec(
      [-7, 2, 0, INT_MIN, -1, 7],
      [
        A.div(10, 1, 2),
        A.rem(11, 1, 2),
        A.divu(12, 1, 2),
        A.remu(13, 1, 2),
        A.div(14, 1, 3),
        A.divu(15, 1, 3),
        A.rem(16, 1, 3),
        A.remu(17, 1, 3),
        A.div(18, 4, 5),
        A.rem(19, 4, 5),
        A.div(20, 6, 1),
        A.rem(21, 6, 1),
      ],
    );
    expect(r[10]).toBe(-3);
    expect(r[11]).toBe(-1);
    expect(r[12]).toBe(0x7ffffffc);
    expect(r[13]).toBe(1);
    expect(r[14]).toBe(-1);
    expect(r[15]).toBe(-1);
    expect(r[16]).toBe(-7);
    expect(r[17]).toBe(-7);
    expect(r[18]).toBe(INT_MIN);
    expect(r[19]).toBe(0);
    expect(r[20]).toBe(-1);
    expect(r[21]).toBe(0);
  });

  it('sign- or zero-extends loads, aligned or not', () => {
    const cpu = run(
      [
        ...A.li(1, DATA),
        A.lb(10, 0, 1),
        A.lbu(11, 0, 1),
        A.lh(12, 0, 1),
        A.lhu(13, 0, 1),
        A.lw(14, 0, 1),
        A.lw(15, 1, 1),
        A.lh(16, 3, 1),
        A.lhu(17, 3, 1),
        A.lb(18, 3, 1),
      ],
      engine,
      (cpu) => cpu.u8.set([0x80, 0x81, 0x82, 0xf3, 0x74], DATA),
    );
    const r = cpu.regs;
    expect(r[10]).toBe(-128);
    expect(r[11]).toBe(0x80);
    expect(r[12]).toBe(-0x7e80);
    expect(r[13]).toBe(0x8180);
    expect(r[14]).toBe(0xf3828180 | 0);
    expect(r[15]).toBe(0x74f38281);
    expect(r[16]).toBe(0x74f3);
    expect(r[17]).toBe(0x74f3);
    expect(r[18]).toBe(-13);
  });

  it('stores bytes, halves and words, aligned or not', () => {
    const cpu = run(
      [
        ...A.li(1, DATA),
        ...A.li(2, 0x11223344),
        A.sw(2, 0, 1),
        A.sh(2, 5, 1),
        A.sb(2, 8, 1),
        A.sw(2, 13, 1),
      ],
      engine,
    );
    expect([...cpu.u8.subarray(DATA, DATA + 17)]).toEqual([
      0x44, 0x33, 0x22, 0x11, 0, 0x44, 0x33, 0, 0x44, 0, 0, 0, 0, 0x44, 0x33, 0x22, 0x11,
    ]);
  });

  it('branches on signed and unsigned comparisons', () => {
    // Each branch skips the "x10 += 1" after it when taken; x11 counts the branches that ran.
    const taken = (branch: number) => [branch, A.addi(10, 10, 1), A.addi(11, 11, 1)];
    const r = exec(
      [-1, 1, 1],
      [
        ...taken(A.beq(2, 3, 8)),
        ...taken(A.bne(1, 2, 8)),
        ...taken(A.blt(1, 2, 8)),
        ...taken(A.bge(2, 1, 8)),
        ...taken(A.bltu(2, 1, 8)),
        ...taken(A.bgeu(1, 2, 8)),
        ...taken(A.beq(1, 2, 8)),
        ...taken(A.bne(2, 3, 8)),
        ...taken(A.blt(2, 1, 8)),
        ...taken(A.bltu(1, 2, 8)),
        ...taken(A.bge(1, 2, 8)),
        ...taken(A.bgeu(2, 1, 8)),
      ],
    );
    expect(r[10]).toBe(6);
    expect(r[11]).toBe(12);
  });

  it('jumps and links; JALR clears bit 0 of the target', () => {
    const r = exec(
      [],
      [
        A.jal(1, 8), // 0x1000 -> 0x1008, x1 = 0x1004
        A.addi(10, 0, 99),
        ...A.li(2, CODE + 0x19), // 0x1008: odd address of the instruction at 0x1018
        A.jalr(3, 2, 0), // 0x1010 -> 0x1018, x3 = 0x1014
        A.addi(11, 0, 99),
        ...A.li(4, CODE + 0x24), // 0x1018
        A.jalr(4, 4, 4), // 0x1020: rd = rs1; goes to 0x1028, x4 = 0x1024
        A.addi(12, 0, 99),
        A.addi(13, 0, 7), // 0x1028
      ],
    );
    expect(r[1]).toBe(CODE + 4);
    expect(r[3]).toBe(CODE + 0x14);
    expect(r[4]).toBe(CODE + 0x24);
    expect(r[10]).toBe(0);
    expect(r[11]).toBe(0);
    expect(r[12]).toBe(0);
    expect(r[13]).toBe(7);
  });

  it('keeps x0 zero, but still performs loads into it', () => {
    const bus = new TestBus();
    bus.values.set(0x10, 0x1234);
    const cpu = makeCpu(
      [
        A.addi(0, 0, 5),
        A.lui(0, 0x1000),
        A.jal(0, 4),
        ...A.li(1, 0x40000010),
        A.lw(0, 0, 1),
        A.add(10, 0, 0),
      ],
      bus,
    );
    execute(cpu, engine);
    expect(cpu.regs[0]).toBe(0);
    expect(cpu.regs[10]).toBe(0);
    expect(bus.reads).toEqual([0x10]);
  });

  it('runs a recursive function with a stack (factorial of 10)', () => {
    // fact(a0): if a0 < 2 return 1; else return a0 * fact(a0 - 1)
    const fact = CODE + 20;
    const r = exec(
      [],
      [
        ...A.li(2, DATA + 0x1000), // sp
        A.addi(10, 0, 10),
        A.jal(1, fact - (CODE + 12)), // at 0x100c
        A.ebreak(),
        // fact, at 0x1014
        A.addi(5, 0, 2),
        A.blt(10, 5, 44),
        A.addi(2, 2, -8),
        A.sw(1, 4, 2),
        A.sw(10, 0, 2),
        A.addi(10, 10, -1),
        A.jal(1, -24),
        A.lw(5, 0, 2),
        A.lw(1, 4, 2),
        A.addi(2, 2, 8),
        A.mul(10, 10, 5),
        A.jalr(0, 1, 0),
        A.addi(10, 0, 1), // base case, at 0x1044
        A.jalr(0, 1, 0),
      ],
    );
    expect(r[10]).toBe(3628800);
    expect(r[2]).toBe(DATA + 0x1000);
  });

  it('sums a loop and counts every instruction', () => {
    // for (i = 100; i != 0; i--) sum += i
    const cpu = run([A.addi(1, 0, 100), A.add(2, 2, 1), A.addi(1, 1, -1), A.bne(1, 0, -8)], engine);
    expect(cpu.regs[2]).toBe(5050);
    expect(cpu.instret).toBe(1 + 300 + 1);
    expect(cpu.trap).toBe('ebreak');
    expect(cpu.pc).toBe(CODE + 16);
  });

  it('stops on ecall and ebreak without moving past them', () => {
    const cpu = run([A.addi(1, 0, 1), A.ecall(), A.addi(1, 0, 2)], engine);
    expect(cpu.trap).toBe('ecall');
    expect(cpu.pc).toBe(CODE + 4);
    expect(cpu.regs[1]).toBe(1);
  });

  it('stops right after a register write that asks it to', () => {
    const bus = new TestBus();
    bus.stopping.add(0x0c);
    const cpu = makeCpu(
      [...A.li(1, 0x4000000c), A.sw(0, 0, 1), A.addi(2, 0, 1), A.addi(2, 0, 2)],
      bus,
    );
    expect(execute(cpu, engine)).toBe(3);
    expect(cpu.pc).toBe(CODE + 12);
    expect(cpu.regs[2]).toBe(0);
    execute(cpu, engine);
    expect(cpu.regs[2]).toBe(2);
  });

  const faults: [string, number[]][] = [
    ['a load from the null page', [A.lw(1, 0, 0)]],
    ['a store to the null page', [A.sb(1, 0x10, 0)]],
    ['a load past the end of RAM', [...A.li(1, 0x10000), A.lbu(2, 0, 1)]],
    ['a byte access to a register', [...A.li(1, 0x40000000), A.sb(1, 0, 1)]],
    ['a register outside the MMIO page', [...A.li(1, 0x40001000), A.lw(2, 0, 1)]],
    ['an all-zero (illegal) instruction', [0]],
    ['an unknown opcode', [0x0000007b]],
    ['a CSR instruction', [0x30002073]],
    ['a jump out of the code', [...A.li(1, DATA), A.jalr(0, 1, 0)]],
    ['a jump to a misaligned address', [...A.li(1, CODE + 6), A.jalr(0, 1, 0)]],
  ];
  it.each(faults)('faults on %s', (_, words) => {
    const cpu = makeCpu(words);
    expect(() => execute(cpu, engine)).toThrow(GuestFault);
  });
});
