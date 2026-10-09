import { describe, expect, it } from 'vitest';
import {
  COOLER_HITS_TO_OPEN,
  DOORS,
  KNIFE_MAX_FLIGHT_SECONDS,
  ROOM_HALF_X,
  flyKnife,
  launchKnife,
  type CoolerDent,
} from '@world/shared';
import { damageAt, dentShape, doorCarries } from './cooler.ts';

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

describe('the knives the walk-in door carries', () => {
  it('are those stuck in its face', () => {
    expect(doorCarries(ROOM_HALF_X + 0.03, 1.2, (DOORS.walkIn.from + DOORS.walkIn.to) / 2)).toBe(
      true,
    );
  });

  it('are never those stuck in the sides of the doorway, once it is open', () => {
    // Shallow throws along the doorway into its sides, which a knife sinks into a few millimetres.
    let sideHits = 0;
    for (const side of [-1, 1]) {
      const z = side < 0 ? DOORS.walkIn.from : DOORS.walkIn.to;
      for (let from = 0.6; from <= 4; from += 0.2) {
        for (let lean = 0.04; lean <= 0.25; lean += 0.03) {
          // Crossing the side halfway through the wall, 10 cm past the kitchen face.
          const start = { x: ROOM_HALF_X - from, z: z - side * (from + 0.1) * Math.tan(lean) };
          // Facing east (yaw -pi/2), turned a little toward the side.
          const knife = launchKnife(start.x, 1.3, start.z, -Math.PI / 2 - side * lean, 0);
          const hit = flyKnife(knife, KNIFE_MAX_FLIGHT_SECONDS, [], -1, true);
          if (hit?.kind !== 'surface' || hit.x < ROOM_HALF_X || Math.abs(hit.z - z) > 0.02)
            continue;
          sideHits++;
          expect(doorCarries(hit.x, hit.y, hit.z), `${hit.x} ${hit.y} ${hit.z}`).toBe(false);
        }
      }
    }
    expect(sideHits).toBeGreaterThan(10);
  });
});
