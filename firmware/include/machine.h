/*
 * The kitchen computer: the whole hardware/software contract in one file.
 *
 * The machine is a single RV32IM hart (no privileged modes, no interrupts, no
 * CSRs) with flat little-endian RAM at address 0 and a page of memory-mapped
 * registers. The host (apps/client/src/computer/) mirrors every value here in
 * abi.ts, and abi.test.ts parses this file to keep the two in step.
 *
 * Memory map
 *
 *   0x00000000  null guard      any access below MACHINE_NULL_GUARD faults
 *   0x00001000  program         the ELF image (.text, .rodata, .data, .bss)
 *               heap            from the end of .bss up to the stack
 *   ..0x01000000 stack          MACHINE_STACK_SIZE bytes, growing down
 *   0x01000000  disk            the WAD, copied in by the host before boot
 *   0x02000000  end of RAM
 *   0x40000000  MMIO            the registers below
 *
 * The disk is the simplest robust design: the host writes the whole image
 * into the disk window before the first instruction runs and reports where
 * and how big it is, so the guest reads it with plain loads, no driver.
 *
 * Execution starts at the ELF entry point with every register zero; crt0
 * sets up the stack. The CPU executes `ebreak` and `ecall` as a halt with an
 * error, so the firmware never uses them.
 */
#ifndef KITCHEN_MACHINE_H
#define KITCHEN_MACHINE_H

#define MACHINE_RAM_SIZE 0x02000000u
#define MACHINE_NULL_GUARD 0x00001000u
#define MACHINE_STACK_TOP 0x01000000u
#define MACHINE_STACK_SIZE 0x00100000u
#define MACHINE_DISK_BASE 0x01000000u
#define MACHINE_DISK_MAX 0x01000000u

#define MACHINE_MMIO_BASE 0x40000000u
#define MACHINE_MMIO_SIZE 0x00001000u

/* W: one byte to the debug console. */
#define MMIO_CONSOLE 0x000u
/* W: power off; the value is the exit status. */
#define MMIO_EXIT 0x004u
/* R: milliseconds of guest time since power on (it stands still while the
   host pauses the machine). */
#define MMIO_TIME_MS 0x008u
/* W: idle until MMIO_TIME_MS has advanced by the value; the host runs
   something else meanwhile. */
#define MMIO_SLEEP_MS 0x00cu
/* R: pop the oldest key event: 0 when the queue is empty, otherwise
   (typed << 16) | (pressed << 8) | key, where key is a DOOM key code
   (doomkeys.h, never 0) and typed the unshifted ASCII character the key
   types, or 0 (W, for one, is the up arrow that types 'w'). */
#define MMIO_KEY 0x010u
/* R: address and size in bytes of the disk image. */
#define MMIO_DISK_ADDR 0x014u
#define MMIO_DISK_SIZE 0x018u
/* R: address of a NUL-terminated string of extra command-line arguments
   (space separated) the host placed in RAM, or 0 for none. */
#define MMIO_ARGS 0x01cu
/* W: RAM address of the 320x200 frame, one palette index per pixel, rows
   top to bottom. */
#define MMIO_FB_ADDR 0x020u
/* W: the frame is complete; the host scans it out through the palette. */
#define MMIO_FB_PRESENT 0x024u
/* W: 256 palette entries, 0x00RRGGBB, at MMIO_PALETTE + 4 * index. */
#define MMIO_PALETTE 0x400u

#define MACHINE_FB_WIDTH 320
#define MACHINE_FB_HEIGHT 200

#define MMIO_KEY_PRESSED 0x100u

#ifndef __ASSEMBLER__
#define MMIO_REG(offset) (*(volatile unsigned int *)(MACHINE_MMIO_BASE + (offset)))
#endif

#endif
