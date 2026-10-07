import { describe, expect, it } from 'vitest';
import * as A from './asm.ts';
import type { Cpu } from './cpu.ts';
import { Jit } from './jit.ts';
import { CODE, DATA, execute, makeCpu, random } from './testRig.ts';

/** Everything architecturally visible after a run. */
function snapshot(cpu: Cpu) {
  return {
    regs: [...cpu.regs],
    pc: cpu.pc,
    instret: cpu.instret,
    trap: cpu.trap,
    ram: Buffer.from(cpu.ram).toString('base64'),
  };
}

const BASE = 16; // x16 holds DATA in the random programs
const COUNTER = 17; // x17 counts loop iterations
const LINK = 18; // x18 is the return address of the inline calls

/** A random but terminating program: ALU and M ops, loads and stores, branches, loops, calls. */
function randomProgram(seed: number): number[] {
  const rand = random(seed);
  const int = (n: number) => Math.floor(rand() * n);
  const reg = () => 1 + int(15);
  const src = () => (rand() < 0.1 ? 0 : rand() < 0.15 ? BASE : reg());
  const edge = [0, 1, -1, 2, -0x80000000, 0x7fffffff, 0xffff, 0x8000, 31, 32];
  const value = () => (rand() < 0.4 ? edge[int(edge.length)]! : (rand() * 2 ** 32) | 0);
  const out: number[] = [...A.li(BASE, DATA)];
  for (let r = 1; r <= 15; r++) out.push(...A.li(r, value()));

  const rType = [A.add, A.sub, A.sll, A.slt, A.sltu, A.xor, A.srl, A.sra, A.or, A.and];
  const mType = [A.mul, A.mulh, A.mulhsu, A.mulhu, A.div, A.divu, A.rem, A.remu];
  const iType = [A.addi, A.slti, A.sltiu, A.xori, A.ori, A.andi];
  const shifts = [A.slli, A.srli, A.srai];
  const loads = [A.lb, A.lh, A.lw, A.lbu, A.lhu];
  const stores = [A.sb, A.sh, A.sw];
  const branches = [A.beq, A.bne, A.blt, A.bge, A.bltu, A.bgeu];
  const alu = (): number => {
    const roll = rand();
    if (roll < 0.35) return rType[int(rType.length)]!(reg(), src(), src());
    if (roll < 0.55) return mType[int(mType.length)]!(reg(), src(), src());
    if (roll < 0.8) return iType[int(iType.length)]!(reg(), src(), int(4096) - 2048);
    if (roll < 0.9) return shifts[int(shifts.length)]!(reg(), src(), int(32));
    return rand() < 0.5 ? A.lui(reg(), value()) : A.auipc(reg(), value());
  };

  const length = 100 + int(200);
  while (out.length < length) {
    const roll = rand();
    if (roll < 0.55) {
      out.push(alu());
    } else if (roll < 0.68) {
      out.push(loads[int(loads.length)]!(reg(), int(2048), BASE));
    } else if (roll < 0.8) {
      out.push(stores[int(stores.length)]!(src(), int(2048), BASE));
    } else if (roll < 0.9) {
      // A forward branch over 1 to 4 instructions.
      const skip = 1 + int(4);
      out.push(branches[int(branches.length)]!(src(), src(), (skip + 1) * 4));
      for (let k = 0; k < skip; k++) out.push(alu());
    } else if (roll < 0.96) {
      // A counted loop.
      const body = 1 + int(5);
      out.push(A.addi(COUNTER, 0, 1 + int(20)));
      for (let k = 0; k < body; k++) out.push(rand() < 0.7 ? alu() : stores[int(3)]!(src(), int(2048), BASE));
      out.push(A.addi(COUNTER, COUNTER, -1), A.bne(COUNTER, 0, -(body + 1) * 4));
    } else {
      // A call to a tiny function placed inline and jumped over.
      out.push(A.jal(LINK, 8), A.jal(0, 12), alu(), A.jalr(0, LINK, 0));
    }
  }
  return out;
}

describe('the JIT against the interpreter', () => {
  it('ends every random program in the same state', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const program = randomProgram(seed);
      const reference = makeCpu(program);
      const translated = makeCpu(program);
      execute(reference, 'interpreter');
      execute(translated, 'jit');
      expect(reference.trap, `seed ${seed}`).toBe('ebreak');
      expect(snapshot(translated), `seed ${seed}`).toEqual(snapshot(reference));
    }
  });

  it('stops at the same instruction when a register write asks it to, and resumes', () => {
    for (let seed = 1; seed <= 50; seed++) {
      const program = randomProgram(seed);
      // Right after the register setup, write the register that stops the CPU.
      program.splice(32, 0, ...A.li(20, 0x4000000c), A.sw(0, 0, 20));
      const cpus = [makeCpu(program), makeCpu(program)] as const;
      for (const cpu of cpus) (cpu.bus as { stopping: Set<number> }).stopping.add(0x0c);
      execute(cpus[0], 'interpreter');
      execute(cpus[1], 'jit');
      expect(cpus[0].trap).toBe(null);
      expect(cpus[0].pc).toBe(CODE + 35 * 4);
      expect(snapshot(cpus[1]), `seed ${seed}`).toEqual(snapshot(cpus[0]));
      execute(cpus[0], 'interpreter');
      execute(cpus[1], 'jit');
      expect(cpus[0].trap).toBe('ebreak');
      expect(snapshot(cpus[1]), `seed ${seed}`).toEqual(snapshot(cpus[0]));
    }
  });

  it('sees code the program rewrites', () => {
    // f() returns 1 in a0; then the program patches f to return 2 and calls it again.
    const f = CODE + 12 * 4;
    const program = [
      A.jal(1, f - CODE), // 0x1000: a0 = f()
      A.add(11, 10, 0), // x11 = first result
      ...A.li(5, A.addi(10, 0, 2)), // the replacement instruction
      ...A.li(6, f),
      A.sw(5, 0, 6), // 0x1018: patch f
      A.jal(1, f - (CODE + 7 * 4)), // 0x101c: a0 = f()
      A.ebreak(), // 0x1020
      0,
      0,
      0,
      A.addi(10, 0, 1), // 0x1030: f
      A.jalr(0, 1, 0),
    ];
    const cpu = makeCpu(program);
    const jit = new Jit(cpu);
    while (!cpu.trap) jit.run(1000);
    expect(cpu.regs[11]).toBe(1);
    expect(cpu.regs[10]).toBe(2);
    expect(cpu.trap).toBe('ebreak');
  });

  it('pauses a long loop near the budget and resumes it exactly', () => {
    // A loop of 3 million instructions, run in slices of 10 000.
    const program = [...A.li(1, 1_000_000), A.add(2, 2, 1), A.addi(1, 1, -1), A.bne(1, 0, -8)];
    const sliced = makeCpu(program);
    const jit = new Jit(sliced);
    let slices = 0;
    while (!sliced.trap) {
      const ran = jit.run(10_000);
      expect(ran).toBeGreaterThanOrEqual(sliced.trap ? 1 : 10_000);
      expect(ran).toBeLessThan(10_000 + 10);
      slices++;
    }
    const whole = makeCpu(program);
    execute(whole, 'interpreter', 10_000_000);
    // Each slice stops at the first loop back edge past its budget.
    expect(slices).toBe(300);
    expect(snapshot(sliced)).toEqual(snapshot(whole));
  });
});
