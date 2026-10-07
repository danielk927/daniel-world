import { describe, expect, it } from 'vitest';
import {
  DISK_BASE,
  MMIO_ARGS,
  MMIO_BASE,
  MMIO_CONSOLE,
  MMIO_DISK_ADDR,
  MMIO_DISK_SIZE,
  MMIO_EXIT,
  MMIO_FB_ADDR,
  MMIO_FB_PRESENT,
  MMIO_KEY,
  MMIO_PALETTE,
  MMIO_SLEEP_MS,
  MMIO_TIME_MS,
} from './abi.ts';
import * as A from './asm.ts';
import { GuestFault } from './cpu.ts';
import { Machine } from './machine.ts';
import { DATA, ENGINES, makeElf } from './testRig.ts';

/** x5 points at the register, then x6 (or `reg`) is stored to / loaded from it. */
const store = (offset: number, value: number) => [
  ...A.li(5, MMIO_BASE + offset),
  ...A.li(6, value),
  A.sw(6, 0, 5),
];
const load = (rd: number, offset: number) => [...A.li(5, MMIO_BASE + offset), A.lw(rd, 0, 5)];
const program = (...parts: number[][]) => makeElf([...parts.flat(), A.ebreak()]);

describe.each(ENGINES)('the machine on the %s', (engine) => {
  const small = () => new Machine({ engine, ramSize: 0x10000 });

  it('prints to the console and powers off with a status', () => {
    const lines: string[] = [];
    const machine = new Machine({ engine, ramSize: 0x10000, console: (line) => lines.push(line) });
    machine.boot(
      program(
        store(MMIO_CONSOLE, 'h'.charCodeAt(0)),
        store(MMIO_CONSOLE, 'i'.charCodeAt(0)),
        store(MMIO_CONSOLE, 10),
        store(MMIO_CONSOLE, '!'.charCodeAt(0)),
        store(MMIO_EXIT, 3),
        store(MMIO_CONSOLE, '?'.charCodeAt(0)),
      ),
    );
    expect(machine.run(1000)).toBe('exit');
    expect(machine.exitCode).toBe(3);
    expect(lines).toEqual(['hi', '!']);
    expect(machine.run(1000)).toBe('exit');
  });

  it('keeps virtual time that moves only when the guest sleeps', () => {
    const machine = small();
    machine.boot(
      program(
        load(10, MMIO_TIME_MS),
        store(MMIO_SLEEP_MS, 30),
        load(11, MMIO_TIME_MS),
        store(MMIO_SLEEP_MS, 5),
        load(12, MMIO_TIME_MS),
      ),
    );
    expect(machine.run(1000)).toBe('trap');
    expect([...machine.cpu.regs.subarray(10, 13)]).toEqual([0, 30, 35]);
  });

  it('sleeps on a real clock until the time comes', () => {
    let now = 100;
    const machine = new Machine({ engine, ramSize: 0x10000, clock: () => now });
    machine.boot(program(store(MMIO_SLEEP_MS, 10), load(10, MMIO_TIME_MS)));
    expect(machine.run(1000)).toBe('sleep');
    const retired = machine.cpu.instret;
    now = 105;
    expect(machine.sleeping).toBe(true);
    expect(machine.run(1000)).toBe('sleep');
    expect(machine.cpu.instret).toBe(retired);
    now = 110;
    expect(machine.run(1000)).toBe('trap');
    expect(machine.cpu.regs[10]).toBe(110);
  });

  it('queues key events in order, with the typed character', () => {
    const machine = small();
    machine.boot(program(load(10, MMIO_KEY), load(11, MMIO_KEY), load(12, MMIO_KEY)));
    machine.key(0xad, true, 0x77);
    machine.key(0xad, false, 0x77);
    machine.run(1000);
    expect([...machine.cpu.regs.subarray(10, 13)]).toEqual([0x7701ad, 0x7700ad, 0]);
  });

  it('drops key events past a full queue', () => {
    const machine = small();
    // Count the events: read the register 70 times, adding one to x8 for each non-zero.
    const reads = Array.from({ length: 70 }, () => [
      ...load(7, MMIO_KEY),
      A.beq(7, 0, 8),
      A.addi(8, 8, 1),
    ]);
    machine.boot(program(...reads));
    for (let k = 0; k < 70; k++) machine.key(13, true);
    machine.run(10_000);
    expect(machine.cpu.regs[8]).toBe(64);
  });

  it('keeps releases when the queue is full, at the cost of the oldest press', () => {
    const machine = small();
    const reads = Array.from({ length: 64 }, (_, k) => [...load(7, MMIO_KEY), A.sw(7, k * 4, 9)]);
    machine.boot(program(A.li(9, DATA), ...reads));
    for (let k = 0; k < 64; k++) machine.key(1 + k, true);
    machine.key(99, false);
    machine.run(10_000);
    const events = [...machine.cpu.i32.subarray(DATA >> 2, (DATA >> 2) + 64)];
    expect(events[0]).toBe(0x100 | 2);
    expect(events[63]).toBe(99);
  });

  it('scans the frame out through the palette when the guest presents it', () => {
    const machine = new Machine({ engine, ramSize: 0x20000 });
    machine.boot(
      program(
        store(MMIO_PALETTE + 4 * 5, 0xff8000),
        store(MMIO_PALETTE, 0x112233),
        store(MMIO_FB_ADDR, DATA),
        A.li(7, DATA),
        [A.addi(8, 0, 5), A.sb(8, 0, 7), A.sb(8, 319, 7)],
        store(MMIO_FB_PRESENT, 1),
      ),
    );
    expect(machine.run(1000)).toBe('frame');
    expect(machine.frames).toBe(1);
    expect(machine.indices[0]).toBe(5);
    expect(machine.indices[1]).toBe(0);
    expect([...machine.screenBytes.subarray(0, 8)]).toEqual([
      0xff, 0x80, 0, 255, 0x11, 0x22, 0x33, 255,
    ]);
    expect(machine.screen[319]).toBe(machine.screen[0]);
    expect(machine.run(1000)).toBe('trap');
  });

  it('faults when the frame is not in RAM', () => {
    const machine = small();
    machine.boot(program(store(MMIO_FB_ADDR, 0xff00), store(MMIO_FB_PRESENT, 1)));
    expect(() => machine.run(1000)).toThrow(GuestFault);
  });

  it('puts the disk and the command line in RAM and says where', () => {
    const machine = new Machine({ engine });
    const disk = new Uint8Array([1, 2, 3, 4, 5, 6]);
    machine.boot(
      program(load(10, MMIO_DISK_ADDR), load(11, MMIO_DISK_SIZE), load(12, MMIO_ARGS)),
      disk,
      '-timedemo demo1',
    );
    machine.run(1000);
    const [addr, size, args] = machine.cpu.regs.subarray(10, 13);
    expect(addr).toBe(DISK_BASE);
    expect(size).toBe(6);
    expect([...machine.cpu.u8.subarray(addr, addr! + 6)]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(args).toBe(DISK_BASE + 8);
    const text = machine.cpu.u8.subarray(args, args! + 16);
    expect(new TextDecoder().decode(text)).toBe('-timedemo demo1\0');
  });

  it('reboots into a clean machine', () => {
    const machine = small();
    machine.boot(program(A.li(7, DATA), [A.addi(8, 0, 9), A.sw(8, 0, 7)], store(MMIO_EXIT, 0)));
    machine.key(1, true);
    expect(machine.run(1000)).toBe('exit');
    expect(machine.cpu.u8[DATA]).toBe(9);
    machine.reboot();
    expect(machine.exitCode).toBe(null);
    expect(machine.cpu.u8[DATA]).toBe(0);
    expect(machine.read(MMIO_KEY)).toBe(0);
    expect(machine.run(1000)).toBe('exit');
  });
});
