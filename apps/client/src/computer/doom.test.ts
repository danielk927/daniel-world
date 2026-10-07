import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FB_HEIGHT, FB_WIDTH } from './abi.ts';
import { DOOM_KEYS } from './keys.ts';
import { Machine } from './machine.ts';
import type { EngineName } from './testRig.ts';

const assets = join(import.meta.dirname, 'assets');
const wadPath = join(assets, 'doom1.wad');
const haveWad = existsSync(wadPath);
if (!haveWad) console.warn(`doom.test.ts: skipping DOOM, ${wadPath} is missing`);

/** A lump of the WAD, read straight from its directory. */
function lump(wad: Uint8Array, name: string): Uint8Array {
  const view = new DataView(wad.buffer, wad.byteOffset, wad.byteLength);
  const count = view.getInt32(4, true);
  const directory = view.getInt32(8, true);
  for (let k = 0; k < count; k++) {
    const at = directory + k * 16;
    const lumpName = new TextDecoder().decode(wad.subarray(at + 8, at + 16)).replace(/\0.*$/, '');
    if (lumpName === name) {
      const offset = view.getInt32(at, true);
      return wad.subarray(offset, offset + view.getInt32(at + 4, true));
    }
  }
  throw new Error(`no lump ${name}`);
}

/** Draws a full-screen DOOM picture (column posts of palette indices) at the origin. */
function decodePicture(data: Uint8Array): Uint8Array {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const width = view.getUint16(0, true);
  const out = new Uint8Array(FB_WIDTH * FB_HEIGHT);
  for (let x = 0; x < width; x++) {
    let at = view.getUint32(8 + 4 * x, true);
    while (data[at] !== 0xff) {
      const top = data[at]!;
      const length = data[at + 1]!;
      for (let y = 0; y < length; y++) out[(top + y) * FB_WIDTH + x] = data[at + 3 + y]!;
      at += length + 4;
    }
  }
  return out;
}

function boot(engine: EngineName, args = ''): Machine {
  const machine = new Machine({ engine });
  machine.boot(readFileSync(join(assets, 'doom.elf')), readFileSync(wadPath), args);
  return machine;
}

function runFrames(machine: Machine, frames: number): void {
  const target = machine.frames + frames;
  while (machine.frames < target) {
    const result = machine.run(10_000_000);
    if (result === 'exit' || result === 'trap') throw new Error(`DOOM stopped: ${result}`);
  }
}

const digest = (machine: Machine) => ({
  pc: machine.cpu.pc,
  instret: machine.cpu.instret,
  regs: [...machine.cpu.regs],
  ram: createHash('sha256').update(machine.cpu.u8).digest('hex'),
});

describe.skipIf(!haveWad)('DOOM on the kitchen computer', () => {
  const wad = haveWad ? readFileSync(wadPath) : new Uint8Array();

  it('boots to the title screen, pixel for pixel', () => {
    const machine = boot('jit');
    runFrames(machine, 5);
    // The frame is exactly TITLEPIC, through palette 0 of PLAYPAL and DOOM's gamma
    // level 0 (not quite the identity: it lifts the darker half by one).
    expect(machine.indices).toEqual(decodePicture(lump(wad, 'TITLEPIC')));
    const playpal = lump(wad, 'PLAYPAL');
    const gamma = (v: number) => (v < 128 ? v + 1 : v);
    for (let i = 0; i < machine.screen.length; i += 97) {
      const index = machine.indices[i]! * 3;
      expect([...machine.screenBytes.subarray(i * 4, i * 4 + 4)]).toEqual([
        gamma(playpal[index]!),
        gamma(playpal[index + 1]!),
        gamma(playpal[index + 2]!),
        255,
      ]);
    }
  });

  it('opens the menu when Escape is pressed', () => {
    const machine = boot('jit');
    runFrames(machine, 5);
    const title = machine.indices.slice();
    machine.key(DOOM_KEYS.Escape!.key, true);
    machine.key(DOOM_KEYS.Escape!.key, false);
    runFrames(machine, 10);
    // The menu sits over the top half of the title.
    let changed = 0;
    for (let i = 0; i < title.length; i++) if (machine.indices[i] !== title[i]) changed++;
    expect(changed).toBeGreaterThan(5000);
  });

  it('saves a game to its in-memory files and loads it back', () => {
    const machine = boot('jit');
    /** Presses a key as KeyboardEvent.code, holding it for `frames` frames. */
    const press = (code: string, frames = 2) => {
      const { key, typed } = DOOM_KEYS[code]!;
      machine.key(key, true, typed);
      runFrames(machine, frames);
      machine.key(key, false, typed);
      runFrames(machine, 3);
    };
    /** The 3D view, without the message line and the status bar. */
    const view = () => machine.indices.slice(320 * 10, 320 * 168);
    const likeness = (a: Uint8Array, b: Uint8Array) =>
      a.filter((v, i) => v === b[i]).length / a.length;

    runFrames(machine, 5);
    for (const code of ['Escape', 'Enter', 'Enter', 'Enter']) press(code); // new game, E1, skill 3
    runFrames(machine, 80);
    press('KeyW', 20);
    runFrames(machine, 40);
    // Save Game, slot 1, named "A": the A key strafes but still types its letter.
    for (const code of [
      'Escape',
      'ArrowDown',
      'ArrowDown',
      'ArrowDown',
      'Enter',
      'Enter',
      'KeyA',
    ]) {
      press(code);
    }
    press('Enter');
    runFrames(machine, 10);
    const saved = view();
    press('KeyW', 40);
    const away = view();
    // Load Game is just above Save Game, where the menu cursor still is.
    for (const code of ['Escape', 'ArrowUp', 'Enter', 'Enter']) press(code);
    runFrames(machine, 80);
    expect(likeness(away, saved)).toBeLessThan(0.5);
    expect(likeness(view(), saved)).toBeGreaterThan(0.99);
  });

  it('plays the start of demo 1 identically on both engines', () => {
    const reference = boot('interpreter', '-timedemo demo1');
    const translated = boot('jit', '-timedemo demo1');
    runFrames(reference, 60);
    runFrames(translated, 60);
    expect(digest(translated)).toEqual(digest(reference));
    // By now it is in E1M1, not on a title or menu screen.
    expect(new Set(reference.indices).size).toBeGreaterThan(60);
    expect(reference.indices).not.toEqual(decodePicture(lump(wad, 'TITLEPIC')));
  }, 60_000);
});
