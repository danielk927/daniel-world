import { NULL_GUARD } from './abi.ts';
import type { Cpu } from './cpu.ts';
import { div, divu, GuestFault, mulh, mulhsu, mulhu, rem, remu } from './cpu.ts';
import {
  funct3,
  funct7,
  immB,
  immI,
  immJ,
  immS,
  immU,
  INST_EBREAK,
  INST_ECALL,
  OP_AUIPC,
  OP_BRANCH,
  OP_FENCE,
  OP_IMM,
  OP_JAL,
  OP_JALR,
  OP_LOAD,
  OP_LUI,
  OP_REG,
  OP_STORE,
  OP_SYSTEM,
  rd,
  rs1,
  rs2,
} from './decode.ts';
import { illegal } from './interpreter.ts';

/**
 * The fast engine: a dynamic binary translator from RISC-V to JavaScript.
 *
 * The unit of translation is a region: everything statically reachable from an entry
 * point without leaving the function (branches and direct jumps are followed, calls,
 * returns and indirect jumps end it). A region becomes one JavaScript function whose body
 * is a loop around a `switch` on the guest pc with one case per basic block, laid out in
 * address order so straight-line code falls through from block to block. Guest registers
 * live in JavaScript locals for the whole call, which V8 keeps in machine registers, and
 * every memory access is inlined with its common case (aligned, in RAM) on the fast path.
 * Loops inside a function stay inside one call; only calls and returns go back through
 * the dispatcher in `run`.
 *
 * Regions are compiled with `new Function`, which needs a Content-Security-Policy that
 * allows 'unsafe-eval' (or none: the site sends no CSP today). The interpreter in
 * interpreter.ts is the reference; jit.test.ts runs both and compares the machine state.
 */

type Region = (pc: number) => number;

type Factory = (
  r: Int32Array,
  u8: Uint8Array,
  i8: Int8Array,
  u16: Uint16Array,
  i16: Int16Array,
  i32: Int32Array,
  cpu: Cpu,
  ctl: Int32Array,
  imul: (a: number, b: number) => number,
  mulh: (a: number, b: number) => number,
  mulhsu: (a: number, b: number) => number,
  mulhu: (a: number, b: number) => number,
  div: (a: number, b: number) => number,
  divu: (a: number, b: number) => number,
  rem: (a: number, b: number) => number,
  remu: (a: number, b: number) => number,
  illegal: (inst: number, pc: number) => GuestFault,
) => Region;

const FACTORY_PARAMS = [
  'r',
  'u8',
  'i8',
  'u16',
  'i16',
  'i32',
  'cpu',
  'ctl',
  'imul',
  'mulh',
  'mulhsu',
  'mulhu',
  'div',
  'divu',
  'rem',
  'remu',
  'illegal',
];

/** Regions stop growing here, so V8 still optimizes the functions they become. */
const MAX_REGION_INSTRUCTIONS = 200;

export interface JitStats {
  regions: number;
  instructions: number;
  compileMs: number;
}

export class Jit {
  private readonly cpu: Cpu;
  /** Region entry points by (pc - codeStart) / 4: every block start of a compiled region. */
  private entries: (Region | undefined)[] = [];
  /** ctl[0]: instructions the current call may run before it must exit at a back edge;
   * ctl[1]: instructions it did run. */
  private readonly ctl = new Int32Array(2);
  readonly stats: JitStats = { regions: 0, instructions: 0, compileMs: 0 };
  /** Keep generated source for inspection (tests, debugging). */
  keepSource = false;
  readonly sources = new Map<number, string>();

  constructor(cpu: Cpu) {
    this.cpu = cpu;
    cpu.onCodeWrite = () => {
      this.flush();
      // The running region may have just overwritten itself: make it exit.
      cpu.stop = true;
    };
    this.flush();
  }

  /** Drops every translation (the code changed). */
  flush(): void {
    const cpu = this.cpu;
    this.entries = new Array<Region | undefined>(Math.max(0, (cpu.codeEnd - cpu.codeStart) >> 2));
    this.sources.clear();
  }

  /** Runs until `budget` instructions have retired (give or take a block) or `cpu.stop`. */
  run(budget: number): number {
    const cpu = this.cpu;
    const ctl = this.ctl;
    const codeStart = cpu.codeStart;
    const codeSpan = cpu.codeEnd - codeStart;
    let pc = cpu.pc;
    let total = 0;
    try {
      while (total < budget) {
        let region = pc & 3 ? undefined : this.entries[(pc - codeStart) >> 2];
        if (region === undefined) {
          if ((pc - codeStart) >>> 0 >= codeSpan || pc & 3) {
            throw new GuestFault('instruction fetch outside code', pc);
          }
          region = this.compile(pc);
        }
        ctl[0] = budget - total;
        ctl[1] = 0;
        pc = region(pc);
        total += ctl[1];
        if (cpu.stop) break;
      }
    } finally {
      cpu.pc = pc;
      cpu.instret += total;
    }
    return total;
  }

  private compile(entry: number): Region {
    const started = performance.now();
    const cpu = this.cpu;
    const plan = planRegion(cpu, entry);
    const source = generate(cpu, plan);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const factory = new Function(...FACTORY_PARAMS, source) as Factory;
    const region = factory(
      cpu.regs,
      cpu.u8,
      cpu.i8,
      cpu.u16,
      cpu.i16,
      cpu.i32,
      cpu,
      this.ctl,
      Math.imul,
      mulh,
      mulhsu,
      mulhu,
      div,
      divu,
      rem,
      remu,
      illegal,
    );
    const base = cpu.codeStart;
    for (const label of plan.labels) {
      const index = (label - base) >> 2;
      this.entries[index] ??= region;
    }
    this.entries[(entry - base) >> 2] = region;
    if (this.keepSource) this.sources.set(entry, source);
    this.stats.regions++;
    this.stats.instructions += plan.pcs.length;
    this.stats.compileMs += performance.now() - started;
    return region;
  }
}

interface Plan {
  entry: number;
  /** Instruction addresses in the region, ascending. */
  pcs: number[];
  /** Block starts: where control can arrive other than by falling through. */
  labels: Set<number>;
}

function isTerminator(inst: number): boolean {
  const op = inst & 0x7f;
  return (
    op === OP_JAL ||
    op === OP_JALR ||
    op === OP_BRANCH ||
    op === OP_SYSTEM ||
    !KNOWN_OPCODES.has(op) ||
    isIllegal(inst)
  );
}

const KNOWN_OPCODES = new Set([
  OP_LUI,
  OP_AUIPC,
  OP_JAL,
  OP_JALR,
  OP_BRANCH,
  OP_LOAD,
  OP_STORE,
  OP_IMM,
  OP_REG,
  OP_FENCE,
  OP_SYSTEM,
]);

/** Encodings the interpreter rejects, so the translation raises the same fault. */
function isIllegal(inst: number): boolean {
  const f3 = funct3(inst);
  const f7 = funct7(inst);
  switch (inst & 0x7f) {
    case OP_JALR:
      return f3 !== 0;
    case OP_BRANCH:
      return f3 === 2 || f3 === 3;
    case OP_LOAD:
      return f3 === 3 || f3 > 5;
    case OP_STORE:
      return f3 > 2;
    case OP_IMM:
      return (f3 === 1 && f7 !== 0) || (f3 === 5 && f7 !== 0 && f7 !== 0x20);
    case OP_REG:
      return !(f7 === 0 || f7 === 1 || (f7 === 0x20 && (f3 === 0 || f3 === 5)));
    case OP_SYSTEM:
      return inst !== INST_ECALL && inst !== INST_EBREAK;
    case OP_LUI:
    case OP_AUIPC:
    case OP_JAL:
    case OP_FENCE:
      return false;
    default:
      return true;
  }
}

/** Finds the instructions and block starts of the region that begins at `entry`. */
function planRegion(cpu: Cpu, entry: number): Plan {
  const { i32, codeStart, codeEnd } = cpu;
  const inCode = (pc: number) => pc >= codeStart && pc < codeEnd;
  const seen = new Set<number>();
  const labels = new Set<number>([entry]);
  const work = [entry];

  while (work.length > 0 && seen.size < MAX_REGION_INSTRUCTIONS) {
    let pc = work.pop()!;
    // Walk straight-line code until a terminator or code we already have.
    while (inCode(pc) && !seen.has(pc) && seen.size < MAX_REGION_INSTRUCTIONS) {
      seen.add(pc);
      const inst = i32[pc >> 2]!;
      if (!isTerminator(inst)) {
        pc += 4;
        continue;
      }
      const op = inst & 0x7f;
      if (op === OP_BRANCH && !isIllegal(inst)) {
        const target = (pc + immB(inst)) | 0;
        if (inCode(target) && (target & 3) === 0) {
          labels.add(target);
          work.push(target);
        }
        labels.add(pc + 4);
        pc += 4;
        continue;
      }
      if (op === OP_JAL) {
        const target = (pc + immJ(inst)) | 0;
        if (rd(inst) === 0) {
          if (inCode(target) && (target & 3) === 0) {
            labels.add(target);
            work.push(target);
          }
        }
      }
      break;
    }
  }

  const pcs = [...seen].sort((a, b) => a - b);
  for (const label of labels) if (!seen.has(label)) labels.delete(label);
  return { entry, pcs, labels };
}

/** JavaScript source of the factory that returns the region's function. */
function generate(cpu: Cpu, plan: Plan): string {
  const { pcs, labels } = plan;
  const { i32 } = cpu;
  const loadSpan = cpu.ramSize - NULL_GUARD;
  const storeFloor = cpu.storeFloor;
  const storeSpan = cpu.ramSize - storeFloor;
  const inRegion = new Set(pcs);
  const used = new Set<number>();
  const written = new Set<number>();
  const out: string[] = [];

  const x = (i: number): string => {
    if (i === 0) return '0';
    used.add(i);
    return `x${i}`;
  };
  const set = (i: number, expr: string): string => {
    if (i === 0) return '';
    used.add(i);
    written.add(i);
    return `x${i} = ${expr};`;
  };
  /** Control transfer to a known address from the instruction at `pc`. */
  const goto = (pc: number, target: number): string => {
    if (!inRegion.has(target) || !labels.has(target)) return `pc = ${target}; break run;`;
    // Only backward jumps can loop, so only they check the budget.
    const check = target <= pc ? `if (n >= lim) { pc = ${target}; break run; } ` : '';
    return `${check}pc = ${target}; continue run;`;
  };

  let blockLength = 0;
  let positionInBlock = 0;
  let blockStart = 0;
  let selfLoop = false;
  for (let k = 0; k < pcs.length; k++) {
    const pc = pcs[k]!;
    if (labels.has(pc)) {
      // Count the block once at its start; early exits give back what they skip.
      blockLength = 0;
      let last = pc;
      for (let j = k; j < pcs.length; j++) {
        const p = pcs[j]!;
        if (j > k && (labels.has(p) || p !== pcs[j - 1]! + 4)) break;
        blockLength++;
        last = p;
        if (isTerminator(i32[p >> 2]!)) break;
      }
      positionInBlock = 0;
      blockStart = pc;
      // A block that branches back to its own start (the pixel loops of the renderer,
      // memcpy) becomes a JavaScript loop, which skips the switch on every iteration.
      const end = i32[last >> 2]!;
      selfLoop = (end & 0x7f) === OP_BRANCH && !isIllegal(end) && ((last + immB(end)) | 0) === pc;
      out.push(
        selfLoop
          ? `case ${pc}: for (;;) { n += ${blockLength};`
          : `case ${pc}: n += ${blockLength};`,
      );
    }
    const remaining = blockLength - positionInBlock - 1;
    positionInBlock++;
    const inst = i32[pc >> 2]!;
    const next = pc + 4;
    const d = rd(inst);
    const op = inst & 0x7f;
    const usesRs1 = op !== OP_LUI && op !== OP_AUIPC && op !== OP_JAL && op !== OP_FENCE;
    const a = usesRs1 && op !== OP_SYSTEM ? x(rs1(inst)) : '0';
    const f3 = funct3(inst);
    const stopCheck = `if (cpu.stop) { pc = ${next}; ${remaining ? `n -= ${remaining}; ` : ''}break run; }`;
    let code: string;

    if (isIllegal(inst) || !KNOWN_OPCODES.has(inst & 0x7f)) {
      code = `pc = ${pc}; throw illegal(${inst}, ${pc});`;
    } else {
      switch (inst & 0x7f) {
        case OP_LUI:
          code = set(d, String(immU(inst)));
          break;
        case OP_AUIPC:
          code = set(d, String((pc + immU(inst)) | 0));
          break;
        case OP_JAL:
          code = `${set(d, String(next))} ${goto(pc, (pc + immJ(inst)) | 0)}`;
          break;
        case OP_JALR:
          code = `pc = (${a} + ${immI(inst)}) & -2; ${set(d, String(next))} break run;`;
          break;
        case OP_BRANCH: {
          const b = x(rs2(inst));
          const cond = [
            `${a} === ${b}`,
            `${a} !== ${b}`,
            '',
            '',
            `${a} < ${b}`,
            `${a} >= ${b}`,
            `(${a} >>> 0) < (${b} >>> 0)`,
            `(${a} >>> 0) >= (${b} >>> 0)`,
          ][f3]!;
          const target = (pc + immB(inst)) | 0;
          code =
            selfLoop && target === blockStart
              ? `if (!(${cond})) break; if (n >= lim) { pc = ${target}; break run; } }`
              : `if (${cond}) { ${goto(pc, target)} }`;
          break;
        }
        case OP_LOAD: {
          const addr = `a = (${a} + ${immI(inst)}) | 0;`;
          const inRam = `(a - ${NULL_GUARD}) >>> 0 < ${loadSpan}`;
          const value = [
            `${inRam} ? i8[a] : cpu.load8(a, ${pc})`,
            `${inRam} && (a & 1) === 0 ? i16[a >> 1] : cpu.load16(a, ${pc})`,
            `${inRam} && (a & 3) === 0 ? i32[a >> 2] : cpu.load32(a, ${pc})`,
            '',
            `${inRam} ? u8[a] : cpu.load8u(a, ${pc})`,
            `${inRam} && (a & 1) === 0 ? u16[a >> 1] : cpu.load16u(a, ${pc})`,
          ][f3]!;
          // A load into x0 still happens: reading a register can have side effects.
          code = d === 0 ? `${addr} ${value};` : `${addr} ${set(d, value)}`;
          break;
        }
        case OP_STORE: {
          const b = x(rs2(inst));
          const inRam = `(a - ${storeFloor}) >>> 0 < ${storeSpan}`;
          const fast = [
            `${inRam}) u8[a] = ${b};`,
            `${inRam} && (a & 1) === 0) i16[a >> 1] = ${b};`,
            `${inRam} && (a & 3) === 0) i32[a >> 2] = ${b};`,
          ][f3]!;
          const slow = ['store8', 'store16', 'store32'][f3]!;
          code =
            `a = (${a} + ${immS(inst)}) | 0; if (${fast} ` +
            `else { cpu.${slow}(a, ${b}, ${pc}); ${stopCheck} }`;
          break;
        }
        case OP_IMM: {
          const imm = immI(inst);
          const sh = imm & 31;
          const expr = [
            a === '0' ? String(imm) : imm === 0 ? a : `(${a} + ${imm}) | 0`,
            `${a} << ${sh}`,
            `${a} < ${imm} ? 1 : 0`,
            `(${a} >>> 0) < ${imm >>> 0} ? 1 : 0`,
            `${a} ^ ${imm}`,
            funct7(inst) === 0 ? `(${a} >>> ${sh}) | 0` : `${a} >> ${sh}`,
            `${a} | ${imm}`,
            `${a} & ${imm}`,
          ][f3]!;
          code = set(d, expr);
          break;
        }
        case OP_REG: {
          const b = x(rs2(inst));
          const f7 = funct7(inst);
          let expr: string;
          if (f7 === 1) {
            expr = [
              `imul(${a}, ${b})`,
              `mulh(${a}, ${b})`,
              `mulhsu(${a}, ${b})`,
              `mulhu(${a}, ${b})`,
              `div(${a}, ${b})`,
              `divu(${a}, ${b})`,
              `rem(${a}, ${b})`,
              `remu(${a}, ${b})`,
            ][f3]!;
          } else if (f7 === 0x20) {
            expr = f3 === 0 ? `(${a} - ${b}) | 0` : `${a} >> ${b}`;
          } else {
            expr = [
              `(${a} + ${b}) | 0`,
              `${a} << ${b}`,
              `${a} < ${b} ? 1 : 0`,
              `(${a} >>> 0) < (${b} >>> 0) ? 1 : 0`,
              `${a} ^ ${b}`,
              `(${a} >>> ${b}) | 0`,
              `${a} | ${b}`,
              `${a} & ${b}`,
            ][f3]!;
          }
          code = set(d, expr);
          break;
        }
        case OP_FENCE:
          code = '';
          break;
        default:
          // OP_SYSTEM: ecall or ebreak (anything else is illegal, handled above).
          code =
            `cpu.trap = '${inst === INST_ECALL ? 'ecall' : 'ebreak'}'; cpu.stop = true; ` +
            `pc = ${pc}; ${remaining ? `n -= ${remaining}; ` : ''}break run;`;
          break;
      }
    }
    out.push(code);

    // Leaving the region by running off the end of what it covers.
    const last = k === pcs.length - 1 || pcs[k + 1] !== next;
    if (last && !isTerminator(inst)) out.push(`pc = ${next}; break run;`);
    if (last && (inst & 0x7f) === OP_BRANCH && !isIllegal(inst)) {
      out.push(`pc = ${next}; break run;`);
    }
  }

  const regs = [...used].sort((p, q) => p - q);
  const prologue = regs.length ? `let ${regs.map((i) => `x${i} = r[${i}]`).join(', ')};` : '';
  const epilogue = [...written]
    .sort((p, q) => p - q)
    .map((i) => `r[${i}] = x${i};`)
    .join(' ');
  const name = `region_${plan.entry.toString(16)}`;
  return `return function ${name}(pc) {
${prologue}
let n = 0, a = 0;
const lim = ctl[0];
run: for (;;) {
switch (pc) {
${out.join('\n')}
default: throw new Error('jit: no block at ' + pc);
}
}
${epilogue}
ctl[1] = n;
return pc;
};`;
}
