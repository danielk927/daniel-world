/**
 * The kitchen computer's hardware contract, mirrored from firmware/include/machine.h
 * (abi.test.ts checks the two agree). See that header for what each register does.
 */

export const RAM_SIZE = 0x0200_0000;
export const NULL_GUARD = 0x0000_1000;
export const STACK_TOP = 0x0100_0000;
export const STACK_SIZE = 0x0010_0000;
export const DISK_BASE = 0x0100_0000;
export const DISK_MAX = 0x0100_0000;

export const MMIO_BASE = 0x4000_0000;
/** Size of the register window; accesses past it fault. */
export const MMIO_SIZE = 0x1000;

export const MMIO_CONSOLE = 0x000;
export const MMIO_EXIT = 0x004;
export const MMIO_TIME_MS = 0x008;
export const MMIO_SLEEP_MS = 0x00c;
export const MMIO_KEY = 0x010;
export const MMIO_DISK_ADDR = 0x014;
export const MMIO_DISK_SIZE = 0x018;
export const MMIO_ARGS = 0x01c;
export const MMIO_FB_ADDR = 0x020;
export const MMIO_FB_PRESENT = 0x024;
export const MMIO_PALETTE = 0x400;

export const FB_WIDTH = 320;
export const FB_HEIGHT = 200;

export const MMIO_KEY_PRESSED = 0x100;
