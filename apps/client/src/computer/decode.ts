/** RV32 instruction fields and immediates, shared by the interpreter and the JIT. */

export const OP_LUI = 0x37;
export const OP_AUIPC = 0x17;
export const OP_JAL = 0x6f;
export const OP_JALR = 0x67;
export const OP_BRANCH = 0x63;
export const OP_LOAD = 0x03;
export const OP_STORE = 0x23;
export const OP_IMM = 0x13;
export const OP_REG = 0x33;
export const OP_FENCE = 0x0f;
export const OP_SYSTEM = 0x73;

export const rd = (inst: number): number => (inst >> 7) & 31;
export const rs1 = (inst: number): number => (inst >> 15) & 31;
export const rs2 = (inst: number): number => (inst >> 20) & 31;
export const funct3 = (inst: number): number => (inst >> 12) & 7;
export const funct7 = (inst: number): number => inst >>> 25;

export const immI = (inst: number): number => inst >> 20;
export const immS = (inst: number): number => ((inst >> 25) << 5) | ((inst >> 7) & 31);
export const immB = (inst: number): number =>
  ((inst >> 31) << 12) |
  (((inst >> 7) & 1) << 11) |
  (((inst >> 25) & 63) << 5) |
  (((inst >> 8) & 15) << 1);
export const immU = (inst: number): number => inst & 0xfffff000;
export const immJ = (inst: number): number =>
  ((inst >> 31) << 20) |
  (((inst >> 12) & 255) << 12) |
  (((inst >> 20) & 1) << 11) |
  (((inst >> 21) & 1023) << 1);

/** The two SYSTEM instructions the machine knows (it has no CSRs). */
export const INST_ECALL = 0x00000073;
export const INST_EBREAK = 0x00100073;
