/**
 * A tiny RV32IM assembler for the tests: one function per instruction, returning its
 * encoding. Registers are numbers (x0..x31); branch and jump offsets are in bytes,
 * relative to the instruction.
 */

const r = (f7: number, rs2: number, rs1: number, f3: number, rd: number, op: number) =>
  ((f7 << 25) | (rs2 << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op) >>> 0;
const i = (imm: number, rs1: number, f3: number, rd: number, op: number) =>
  (((imm & 0xfff) << 20) | (rs1 << 15) | (f3 << 12) | (rd << 7) | op) >>> 0;
const s = (imm: number, rs2: number, rs1: number, f3: number) =>
  ((((imm >> 5) & 0x7f) << 25) |
    (rs2 << 20) |
    (rs1 << 15) |
    (f3 << 12) |
    ((imm & 31) << 7) |
    0x23) >>>
  0;
const b = (imm: number, rs2: number, rs1: number, f3: number) =>
  ((((imm >> 12) & 1) << 31) |
    (((imm >> 5) & 0x3f) << 25) |
    (rs2 << 20) |
    (rs1 << 15) |
    (f3 << 12) |
    (((imm >> 1) & 15) << 8) |
    (((imm >> 11) & 1) << 7) |
    0x63) >>>
  0;

export const lui = (rd: number, value: number) => ((value & 0xfffff000) | (rd << 7) | 0x37) >>> 0;
export const auipc = (rd: number, value: number) => ((value & 0xfffff000) | (rd << 7) | 0x17) >>> 0;
export const jal = (rd: number, offset: number) =>
  ((((offset >> 20) & 1) << 31) |
    (((offset >> 1) & 0x3ff) << 21) |
    (((offset >> 11) & 1) << 20) |
    (((offset >> 12) & 0xff) << 12) |
    (rd << 7) |
    0x6f) >>>
  0;
export const jalr = (rd: number, rs1: number, imm: number) => i(imm, rs1, 0, rd, 0x67);

export const beq = (rs1: number, rs2: number, offset: number) => b(offset, rs2, rs1, 0);
export const bne = (rs1: number, rs2: number, offset: number) => b(offset, rs2, rs1, 1);
export const blt = (rs1: number, rs2: number, offset: number) => b(offset, rs2, rs1, 4);
export const bge = (rs1: number, rs2: number, offset: number) => b(offset, rs2, rs1, 5);
export const bltu = (rs1: number, rs2: number, offset: number) => b(offset, rs2, rs1, 6);
export const bgeu = (rs1: number, rs2: number, offset: number) => b(offset, rs2, rs1, 7);

export const lb = (rd: number, imm: number, rs1: number) => i(imm, rs1, 0, rd, 0x03);
export const lh = (rd: number, imm: number, rs1: number) => i(imm, rs1, 1, rd, 0x03);
export const lw = (rd: number, imm: number, rs1: number) => i(imm, rs1, 2, rd, 0x03);
export const lbu = (rd: number, imm: number, rs1: number) => i(imm, rs1, 4, rd, 0x03);
export const lhu = (rd: number, imm: number, rs1: number) => i(imm, rs1, 5, rd, 0x03);
export const sb = (rs2: number, imm: number, rs1: number) => s(imm, rs2, rs1, 0);
export const sh = (rs2: number, imm: number, rs1: number) => s(imm, rs2, rs1, 1);
export const sw = (rs2: number, imm: number, rs1: number) => s(imm, rs2, rs1, 2);

export const addi = (rd: number, rs1: number, imm: number) => i(imm, rs1, 0, rd, 0x13);
export const slti = (rd: number, rs1: number, imm: number) => i(imm, rs1, 2, rd, 0x13);
export const sltiu = (rd: number, rs1: number, imm: number) => i(imm, rs1, 3, rd, 0x13);
export const xori = (rd: number, rs1: number, imm: number) => i(imm, rs1, 4, rd, 0x13);
export const ori = (rd: number, rs1: number, imm: number) => i(imm, rs1, 6, rd, 0x13);
export const andi = (rd: number, rs1: number, imm: number) => i(imm, rs1, 7, rd, 0x13);
export const slli = (rd: number, rs1: number, sh: number) => i(sh, rs1, 1, rd, 0x13);
export const srli = (rd: number, rs1: number, sh: number) => i(sh, rs1, 5, rd, 0x13);
export const srai = (rd: number, rs1: number, sh: number) => i(0x400 | sh, rs1, 5, rd, 0x13);

export const add = (rd: number, rs1: number, rs2: number) => r(0, rs2, rs1, 0, rd, 0x33);
export const sub = (rd: number, rs1: number, rs2: number) => r(0x20, rs2, rs1, 0, rd, 0x33);
export const sll = (rd: number, rs1: number, rs2: number) => r(0, rs2, rs1, 1, rd, 0x33);
export const slt = (rd: number, rs1: number, rs2: number) => r(0, rs2, rs1, 2, rd, 0x33);
export const sltu = (rd: number, rs1: number, rs2: number) => r(0, rs2, rs1, 3, rd, 0x33);
export const xor = (rd: number, rs1: number, rs2: number) => r(0, rs2, rs1, 4, rd, 0x33);
export const srl = (rd: number, rs1: number, rs2: number) => r(0, rs2, rs1, 5, rd, 0x33);
export const sra = (rd: number, rs1: number, rs2: number) => r(0x20, rs2, rs1, 5, rd, 0x33);
export const or = (rd: number, rs1: number, rs2: number) => r(0, rs2, rs1, 6, rd, 0x33);
export const and = (rd: number, rs1: number, rs2: number) => r(0, rs2, rs1, 7, rd, 0x33);

export const mul = (rd: number, rs1: number, rs2: number) => r(1, rs2, rs1, 0, rd, 0x33);
export const mulh = (rd: number, rs1: number, rs2: number) => r(1, rs2, rs1, 1, rd, 0x33);
export const mulhsu = (rd: number, rs1: number, rs2: number) => r(1, rs2, rs1, 2, rd, 0x33);
export const mulhu = (rd: number, rs1: number, rs2: number) => r(1, rs2, rs1, 3, rd, 0x33);
export const div = (rd: number, rs1: number, rs2: number) => r(1, rs2, rs1, 4, rd, 0x33);
export const divu = (rd: number, rs1: number, rs2: number) => r(1, rs2, rs1, 5, rd, 0x33);
export const rem = (rd: number, rs1: number, rs2: number) => r(1, rs2, rs1, 6, rd, 0x33);
export const remu = (rd: number, rs1: number, rs2: number) => r(1, rs2, rs1, 7, rd, 0x33);

export const fence = () => 0x0ff0000f;
export const ecall = () => 0x00000073;
export const ebreak = () => 0x00100073;

/** Loads any 32-bit constant: LUI for the upper bits (rounded for ADDI's sign), then ADDI. */
export const li = (rd: number, value: number): number[] => {
  const low = (value << 20) >> 20;
  return [lui(rd, (value - low) | 0), addi(rd, rd, low)];
};
