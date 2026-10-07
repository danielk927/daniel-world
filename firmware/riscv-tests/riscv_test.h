/*
 * Test environment for the official RISC-V ISA tests (riscv-tests) on the
 * kitchen computer: no privileged modes and no CSRs, so a test just runs
 * from _start and reports through MMIO_EXIT, 0 for pass and
 * (test number << 1) | 1 for the first case that failed.
 */
#ifndef KITCHEN_RISCV_TEST_H
#define KITCHEN_RISCV_TEST_H

#include "machine.h"

#define RVTEST_RV32U
#define RVTEST_RV64U
#define RVTEST_RV32M
#define RVTEST_RV64M

#define TESTNUM gp

#define RVTEST_CODE_BEGIN \
    .text;                \
    .globl _start;        \
    _start:

#define RVTEST_CODE_END unimp

#define RVTEST_EXIT(code)              \
    li t0, MACHINE_MMIO_BASE + MMIO_EXIT; \
    sw code, 0(t0);                    \
    1: j 1b

#define RVTEST_PASS \
    li a0, 0;       \
    RVTEST_EXIT(a0)

#define RVTEST_FAIL          \
    slli a0, TESTNUM, 1;     \
    ori a0, a0, 1;           \
    RVTEST_EXIT(a0)

#define RVTEST_DATA_BEGIN \
    .align 4;             \
    .global begin_signature; \
    begin_signature:

#define RVTEST_DATA_END \
    .align 4;           \
    .global end_signature; \
    end_signature:

#endif
