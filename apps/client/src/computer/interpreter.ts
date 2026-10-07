import { NULL_GUARD } from './abi.ts';
import type { Cpu } from './cpu.ts';
import { div, divu, GuestFault, hex, mulh, mulhsu, mulhu, rem, remu } from './cpu.ts';
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

export function illegal(inst: number, pc: number): GuestFault {
  return new GuestFault(`illegal instruction ${hex(inst)}`, pc);
}

/**
 * The reference engine: decode and execute one instruction at a time, as plainly as
 * possible. The JIT is tested against it. Runs until `budget` instructions have retired
 * or something sets `cpu.stop`, and returns the number retired.
 */
export function interpret(cpu: Cpu, budget: number): number {
  const r = cpu.regs;
  const { u8, i8, u16, i16, i32, ramSize } = cpu;
  const codeStart = cpu.codeStart;
  const codeSpan = cpu.codeEnd - codeStart;
  const loadSpan = ramSize - NULL_GUARD;
  const storeFloor = cpu.storeFloor;
  const storeSpan = ramSize - storeFloor;
  let pc = cpu.pc;
  let n = 0;
  // Only slow-path accesses and traps can stop the CPU, so only they make us look.
  let check = false;

  try {
    while (n < budget) {
      if ((pc - codeStart) >>> 0 >= codeSpan || pc & 3) {
        throw new GuestFault('instruction fetch outside code', pc);
      }
      const inst = i32[pc >> 2]!;
      const d = rd(inst);
      let next = pc + 4;
      n++;

      switch (inst & 0x7f) {
        case OP_LUI:
          if (d !== 0) r[d] = immU(inst);
          break;

        case OP_AUIPC:
          if (d !== 0) r[d] = pc + immU(inst);
          break;

        case OP_JAL:
          if (d !== 0) r[d] = next;
          next = (pc + immJ(inst)) | 0;
          break;

        case OP_JALR: {
          if (funct3(inst) !== 0) throw illegal(inst, pc);
          const target = (r[rs1(inst)]! + immI(inst)) & ~1;
          if (d !== 0) r[d] = next;
          next = target;
          break;
        }

        case OP_BRANCH: {
          const a = r[rs1(inst)]!;
          const b = r[rs2(inst)]!;
          let taken: boolean;
          switch (funct3(inst)) {
            case 0:
              taken = a === b;
              break;
            case 1:
              taken = a !== b;
              break;
            case 4:
              taken = a < b;
              break;
            case 5:
              taken = a >= b;
              break;
            case 6:
              taken = a >>> 0 < b >>> 0;
              break;
            case 7:
              taken = a >>> 0 >= b >>> 0;
              break;
            default:
              throw illegal(inst, pc);
          }
          if (taken) next = (pc + immB(inst)) | 0;
          break;
        }

        case OP_LOAD: {
          const addr = (r[rs1(inst)]! + immI(inst)) | 0;
          const fast = (addr - NULL_GUARD) >>> 0 < loadSpan;
          let value: number;
          switch (funct3(inst)) {
            case 0:
              value = fast ? i8[addr]! : cpu.load8(addr, pc);
              break;
            case 1:
              value = fast && (addr & 1) === 0 ? i16[addr >> 1]! : cpu.load16(addr, pc);
              break;
            case 2:
              value = fast && (addr & 3) === 0 ? i32[addr >> 2]! : cpu.load32(addr, pc);
              break;
            case 4:
              value = fast ? u8[addr]! : cpu.load8u(addr, pc);
              break;
            case 5:
              value = fast && (addr & 1) === 0 ? u16[addr >> 1]! : cpu.load16u(addr, pc);
              break;
            default:
              throw illegal(inst, pc);
          }
          if (!fast) check = true;
          if (d !== 0) r[d] = value;
          break;
        }

        case OP_STORE: {
          const addr = (r[rs1(inst)]! + immS(inst)) | 0;
          const value = r[rs2(inst)]!;
          const fast = (addr - storeFloor) >>> 0 < storeSpan;
          switch (funct3(inst)) {
            case 0:
              if (fast) u8[addr] = value;
              else cpu.store8(addr, value, pc);
              break;
            case 1:
              if (fast && (addr & 1) === 0) i16[addr >> 1] = value;
              else cpu.store16(addr, value, pc);
              break;
            case 2:
              if (fast && (addr & 3) === 0) i32[addr >> 2] = value;
              else cpu.store32(addr, value, pc);
              break;
            default:
              throw illegal(inst, pc);
          }
          if (!fast) check = true;
          break;
        }

        case OP_IMM: {
          const a = r[rs1(inst)]!;
          const imm = immI(inst);
          let value: number;
          switch (funct3(inst)) {
            case 0:
              value = (a + imm) | 0;
              break;
            case 1:
              if (funct7(inst) !== 0) throw illegal(inst, pc);
              value = a << imm;
              break;
            case 2:
              value = a < imm ? 1 : 0;
              break;
            case 3:
              value = a >>> 0 < imm >>> 0 ? 1 : 0;
              break;
            case 4:
              value = a ^ imm;
              break;
            case 5:
              if (funct7(inst) === 0) value = (a >>> imm) | 0;
              else if (funct7(inst) === 0x20) value = a >> imm;
              else throw illegal(inst, pc);
              break;
            case 6:
              value = a | imm;
              break;
            default:
              value = a & imm;
              break;
          }
          if (d !== 0) r[d] = value;
          break;
        }

        case OP_REG: {
          const a = r[rs1(inst)]!;
          const b = r[rs2(inst)]!;
          const f7 = funct7(inst);
          const f3 = funct3(inst);
          let value: number;
          if (f7 === 0) {
            switch (f3) {
              case 0:
                value = (a + b) | 0;
                break;
              case 1:
                value = a << b;
                break;
              case 2:
                value = a < b ? 1 : 0;
                break;
              case 3:
                value = a >>> 0 < b >>> 0 ? 1 : 0;
                break;
              case 4:
                value = a ^ b;
                break;
              case 5:
                value = (a >>> b) | 0;
                break;
              case 6:
                value = a | b;
                break;
              default:
                value = a & b;
                break;
            }
          } else if (f7 === 0x20 && f3 === 0) {
            value = (a - b) | 0;
          } else if (f7 === 0x20 && f3 === 5) {
            value = a >> b;
          } else if (f7 === 1) {
            switch (f3) {
              case 0:
                value = Math.imul(a, b);
                break;
              case 1:
                value = mulh(a, b);
                break;
              case 2:
                value = mulhsu(a, b);
                break;
              case 3:
                value = mulhu(a, b);
                break;
              case 4:
                value = div(a, b);
                break;
              case 5:
                value = divu(a, b);
                break;
              case 6:
                value = rem(a, b);
                break;
              default:
                value = remu(a, b);
                break;
            }
          } else {
            throw illegal(inst, pc);
          }
          if (d !== 0) r[d] = value;
          break;
        }

        case OP_FENCE:
          // One hart, no caches: FENCE orders nothing, and stores into code already
          // invalidate translations, so FENCE.I has nothing left to do either.
          break;

        case OP_SYSTEM:
          if (inst === INST_ECALL || inst === INST_EBREAK) {
            cpu.trap = inst === INST_ECALL ? 'ecall' : 'ebreak';
            cpu.stop = true;
            check = true;
            next = pc;
            break;
          }
          throw illegal(inst, pc);

        default:
          throw illegal(inst, pc);
      }

      pc = next;
      if (check) {
        check = false;
        if (cpu.stop) break;
      }
    }
  } finally {
    cpu.pc = pc;
    cpu.instret += n;
  }
  return n;
}
