/**
 * Benchmark of the kitchen computer: DOOM's own `-timedemo demo1` on each execution engine.
 *
 *   node scripts/computer-bench.ts [--engine jit|interpreter] [--png frame.png]
 *
 * The demo runs as fast as the emulator can go (virtual time, no sleeping), so it reports
 * guest instructions per second and frames per second of real DOOM rendering, plus the time
 * to boot to the title screen. --png saves the last frame of the demo.
 */
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { crc32, deflateSync } from 'node:zlib';
import type { Engine } from '../apps/client/src/computer/machine.ts';
import { Machine } from '../apps/client/src/computer/machine.ts';

const assets = resolve(import.meta.dirname, '../apps/client/src/computer/assets');
const programPath = resolve(assets, 'doom.elf');
const wadPath = resolve(assets, 'doom1.wad');

const { values } = parseArgs({
  options: { engine: { type: 'string' }, png: { type: 'string' } },
});
const engines: Engine[] = values.engine ? [values.engine as Engine] : ['jit', 'interpreter'];
const program = readFileSync(programPath);
const wad = readFileSync(wadPath);

console.log(`doom.elf  ${statSync(programPath).size} bytes`);
console.log(`doom1.wad ${statSync(wadPath).size} bytes`);

function bootTime(engine: Engine): number {
  const started = performance.now();
  const machine = new Machine({ engine });
  machine.boot(program, wad);
  while (machine.frames < 1) machine.run(1_000_000);
  return performance.now() - started;
}

function timedemo(engine: Engine): Machine {
  const machine = new Machine({ engine });
  machine.boot(program, wad, '-timedemo demo1');
  const started = performance.now();
  while (machine.run(10_000_000) !== 'exit') {
    // The demo ends in I_Error("timed N gametics..."), which powers off.
  }
  const seconds = (performance.now() - started) / 1000;
  const compileMs = machine.jitStats?.compileMs ?? 0;
  const instructions = machine.cpu.instret;
  console.log(
    `${engine.padEnd(11)} ${(instructions / seconds / 1e6).toFixed(0).padStart(5)} MIPS  ` +
      `${(machine.frames / seconds).toFixed(0).padStart(5)} fps  ` +
      `(${machine.frames} frames, ${(instructions / 1e9).toFixed(2)}G instructions, ` +
      `${(instructions / machine.frames / 1e6).toFixed(2)}M per frame, ${seconds.toFixed(1)} s` +
      (compileMs ? `, ${compileMs.toFixed(0)} ms compiling` : '') +
      `)  boot to title ${bootTime(engine).toFixed(0)} ms`,
  );
  return machine;
}

let last: Machine | null = null;
for (const engine of engines) last = timedemo(engine);

if (values.png && last) {
  writeFileSync(values.png, png(last.screenBytes, 320, 200));
  console.log(`last frame -> ${values.png}`);
}

/** A minimal RGBA PNG encoder. */
function png(rgba: Uint8ClampedArray, width: number, height: number): Buffer {
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    rows.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
