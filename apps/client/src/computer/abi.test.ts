import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as abi from './abi.ts';

describe('the ABI', () => {
  it('matches firmware/include/machine.h, define for define', () => {
    const header = readFileSync(
      join(import.meta.dirname, '../../../../firmware/include/machine.h'),
      'utf8',
    );
    const defines = [...header.matchAll(/^#define (\w+) (0x[0-9a-f]+|\d+)u?$/gm)];
    expect(defines.length).toBeGreaterThan(15);
    const mirrored = abi as Record<string, number>;
    for (const [, name, value] of defines) {
      const key = name!.replace(/^MACHINE_/, '');
      expect(mirrored[key], name).toBe(Number(value));
    }
    // And nothing in abi.ts is missing from the header.
    const names = new Set(defines.map(([, name]) => name!.replace(/^MACHINE_/, '')));
    for (const key of Object.keys(abi)) expect(names.has(key), key).toBe(true);
  });
});
