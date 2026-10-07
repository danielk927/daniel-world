/* Reset: the CPU starts here with every register zero. */

#include "machine.h"

    .section .text.start, "ax"
    .globl _start
_start:
    /* gp first, without relaxation: the relaxed form would read gp itself. */
    .option push
    .option norelax
    la gp, __global_pointer$
    .option pop
    li sp, MACHINE_STACK_TOP

    /* Zero .bss. The host hands over zeroed RAM, but a reboot must not rely
       on that. */
    la t0, __bss_start
    la t1, __bss_end
1:  bgeu t0, t1, 2f
    sw zero, 0(t0)
    addi t0, t0, 4
    j 1b
2:
    li a0, 0
    li a1, 0
    call main
    call exit
