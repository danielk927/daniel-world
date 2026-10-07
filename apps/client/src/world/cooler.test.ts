import { describe, expect, it } from 'vitest';
import { COOLER_HITS_TO_OPEN, type CoolerDent } from '@world/shared';
import { damageAt, dentShape } from './cooler.ts';

const fist: CoolerDent = { z: -3, y: 1.62, by: 'fist' };
const knife: CoolerDent = { z: -2.6, y: 1.1, by: 'knife' };

describe("the walk-in door's dents", () => {
  it('are the same on every screen for the same hit, wherever it falls in the order', () => {
    expect(dentShape(fist, 3)).toEqual(dentShape({ ...fist }, 3));
    // A second punch on the same spot is a fresh dent of its own, not a copy of the first.
    expect(dentShape(fist, 4)).not.toEqual(dentShape(fist, 3));
  });

  it('sit where the hit landed: a fist wide and deep, a knife small and sharp', () => {
    const f = dentShape(fist, 0);
    const k = dentShape(knife, 1);
    expect([f.z, f.y]).toEqual([fist.z, fist.y]);
    expect(f.rz).toBeGreaterThan(k.rz * 1.5);
    expect(f.depth).toBeGreaterThan(k.depth);
    // Wider across than tall, like a row of knuckles.
    expect(f.rz).toBeGreaterThan(f.ry);
  });
});

describe('the walk-in door, worse with every hit', () => {
  const stages = Array.from({ length: COOLER_HITS_TO_OPEN }, (_, n) => damageAt(n));

  it('starts whole: level handle, a steady readout, square in its frame', () => {
    const whole = stages[0]!;
    expect(whole).toMatchObject({ bow: 0, handle: 0, shift: 0, sag: 0, flicker: 0, dead: false });
    expect(whole.temperature).toBe(3);
  });

  it('never gets better: the handle droops, the face bows, the grime builds', () => {
    for (let n = 1; n < stages.length; n++) {
      const [before, after] = [stages[n - 1]!, stages[n]!];
      expect(after.handle).toBeGreaterThanOrEqual(before.handle);
      expect(after.bow).toBeGreaterThanOrEqual(before.bow);
      expect(after.grime).toBeGreaterThan(before.grime);
      expect(after.shift).toBeGreaterThanOrEqual(before.shift);
    }
    expect(stages.at(-1)!.handle).toBeGreaterThan(1);
  });

  it('loses its readout: warming up, then flickering, then dark', () => {
    const firstFlicker = stages.findIndex((d) => d.flicker > 0);
    const firstDead = stages.findIndex((d) => d.dead);
    expect(firstFlicker).toBeGreaterThan(0);
    expect(firstDead).toBeGreaterThan(firstFlicker);
    expect(stages[firstFlicker]!.temperature).toBeGreaterThan(stages[0]!.temperature);
  });

  it('shifts in its frame just before it gives', () => {
    expect(stages[COOLER_HITS_TO_OPEN - 3]!.shift).toBe(0);
    expect(stages[COOLER_HITS_TO_OPEN - 1]!.shift).toBeGreaterThan(0);
  });
});
