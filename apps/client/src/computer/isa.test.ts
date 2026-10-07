import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Machine } from './machine.ts';
import { ENGINES } from './testRig.ts';

// The official RISC-V ISA tests (github.com/riscv-software-src/riscv-tests) for RV32I and
// M, built by firmware/riscv-tests/build.sh. Each exits with 0, or with
// (failing case << 1) | 1.
const dir = join(import.meta.dirname, 'testdata', 'riscv-tests');
const tests = readdirSync(dir)
  .filter((name) => name.endsWith('.elf'))
  .sort();

describe.each(ENGINES)('riscv-tests on the %s', (engine) => {
  const machine = new Machine({ engine, ramSize: 0x100000 });

  it('has the whole suite', () => {
    expect(tests.length).toBeGreaterThanOrEqual(48);
  });

  it.each(tests)('%s', (name) => {
    machine.boot(readFileSync(join(dir, name)));
    expect(machine.run(1_000_000)).toBe('exit');
    const code = machine.exitCode!;
    expect(code, `case ${code >> 1} failed`).toBe(0);
  });
});
