import { InstancedMesh, Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  KNIFE_MAX_STUCK,
  TICK_SECONDS,
  flyKnife,
  launchKnife,
  thrownKnife,
  type KnifeState,
  type StuckKnife,
} from '@world/shared';
import { Knives } from './knives.ts';

const DOWN = -Math.PI / 2 + 0.01;
/** A knife thrown straight down into the clear aisle floor. */
const intoFloor = () => launchKnife(0, 1.6, 2.6, 0, DOWN);
const stuckAt = (id: number, x = 0): StuckKnife => ({
  id,
  x,
  y: -0.04,
  z: 2.6,
  dx: 0,
  dy: -1,
  dz: 0,
});

function run(knives: Knives, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) knives.update(1 / 60, []);
}

describe('Knives', () => {
  it('sticks an offline throw where it lands', () => {
    const knives = new Knives();
    knives.throwOwn(0, 1, intoFloor(), false);
    expect(knives.flyingCount).toBe(1);
    run(knives, 0.5);
    expect(knives.flyingCount).toBe(0);
    expect(knives.stuckCount).toBe(1);
    expect(knives.drawnCount).toBe(1);
  });

  it('waits for the server, then sticks the knife where the server says', () => {
    const knives = new Knives();
    knives.throwOwn(5, 1, intoFloor(), true);
    knives.launch(9, 1, 5, intoFloor(), true, 0);
    run(knives, 0.5);
    // Landed on this screen, still waiting for the verdict.
    expect(knives.flyingCount).toBe(1);
    expect(knives.stuckCount).toBe(0);
    knives.resolve(9, { kind: 'stuck', knife: stuckAt(9, 0.01), at: 0.1 });
    run(knives, 1 / 30);
    expect(knives.flyingCount).toBe(0);
    expect(knives.stuckCount).toBe(1);
  });

  it("measures how far the server's verdict moves a knife from where this screen flew it", () => {
    /** Where the server, flying a tick at a time, has this knife stick. */
    const verdict = (id: number, knife: KnifeState): StuckKnife => {
      for (;;) {
        const impact = flyKnife(knife, TICK_SECONDS, [], 1);
        if (impact?.kind === 'surface') {
          const { x, y, z, dx, dy, dz } = impact;
          return { id, x, y, z, dx, dy, dz };
        }
      }
    };
    const knives = new Knives();
    // Our own throw, launched just as the server launches it.
    knives.throwOwn(5, 1, thrownKnife(0, 1.6, 2.6, 0, DOWN, 1, 5), true);
    knives.launch(9, 1, 5, thrownKnife(0, 1.6, 2.6, 0, DOWN, 1, 5), true, 0);
    run(knives, 0.5);
    knives.resolve(9, {
      kind: 'stuck',
      knife: verdict(9, thrownKnife(0, 1.6, 2.6, 0, DOWN, 1, 5)),
      at: 0.1,
    });
    run(knives, 1 / 30);
    expect(knives.stuckKnives().map((k) => k.id)).toEqual([9]);
    expect(knives.maxCorrection).toBeLessThan(1e-3);
    // One this screen launched another way than the server did jumps to where the server says.
    knives.throwOwn(19, 1, launchKnife(0, 1.6, 2.6, 0, DOWN), true);
    knives.launch(10, 1, 19, launchKnife(0, 1.6, 2.6, 0, DOWN), true, 0);
    run(knives, 0.5);
    const here = verdict(10, launchKnife(0, 1.6, 2.6, 0, DOWN));
    const there = verdict(10, thrownKnife(0, 1.6, 2.6, 0, DOWN, 1, 19));
    knives.resolve(10, { kind: 'stuck', knife: there, at: 0.1 });
    run(knives, 1 / 30);
    expect(knives.stuckKnives().map((k) => k.id)).toEqual([9, 10]);
    const jump = Math.hypot(there.x - here.x, there.y - here.y, there.z - here.z);
    expect(jump).toBeGreaterThan(1e-3);
    expect(knives.maxCorrection).toBeCloseTo(jump, 6);
  });

  it('holds back a remote knife until it leaves the thrower as drawn', () => {
    const knives = new Knives();
    knives.launch(1, 2, 0, intoFloor(), false, 0.1);
    knives.update(1 / 20, []);
    expect(knives.drawnCount).toBe(0);
    knives.update(1 / 10, []);
    expect(knives.drawnCount).toBe(1);
  });

  it('takes a knife away when the server says it hit someone, as it gets there', () => {
    const knives = new Knives();
    knives.launch(1, 2, 0, launchKnife(0, 1.6, 5.6, 0, 0), false, 0);
    knives.resolve(1, { kind: 'kill', at: 0.2 });
    run(knives, 0.1);
    expect(knives.flyingCount).toBe(1);
    run(knives, 0.15);
    expect(knives.flyingCount).toBe(0);
    expect(knives.stuckCount).toBe(0);
  });

  it('moves the knives in the walk-in door as soon as the door moves, not a frame later', () => {
    const knives = new Knives();
    knives.reset([stuckAt(1)]);
    const motion = new Matrix4();
    knives.setCarrier({ carries: () => true, motion });
    knives.update(0, []);
    const mesh = knives.group.children.find(
      (c): c is InstancedMesh => c instanceof InstancedMesh && c.count > 0,
    )!;
    const before = new Matrix4();
    mesh.getMatrixAt(0, before);
    // The door swings after the knives are drawn in a frame, and says so.
    motion.makeTranslation(0.5, 0, 0);
    knives.carrierMoved();
    const after = new Matrix4();
    mesh.getMatrixAt(0, after);
    expect(after.elements[12] - before.elements[12]).toBeCloseTo(0.5, 6);
  });

  it('keeps only the newest stuck knives', () => {
    const knives = new Knives();
    knives.reset(Array.from({ length: KNIFE_MAX_STUCK }, (_, i) => stuckAt(i)));
    expect(knives.stuckCount).toBe(KNIFE_MAX_STUCK);
    knives.resolve(500, { kind: 'stuck', knife: stuckAt(500), at: 0 });
    knives.update(0, []);
    expect(knives.stuckCount).toBe(KNIFE_MAX_STUCK);
    expect(knives.drawnCount).toBe(KNIFE_MAX_STUCK);
  });

  it('lets a knife flying at a player vanish into them on screen while the server decides', () => {
    const knives = new Knives();
    knives.throwOwn(0, 1, launchKnife(0, 1.62, 5.6, 0, -0.1), true);
    for (let i = 0; i < 20; i++) knives.update(1 / 60, [{ id: 2, x: 0, y: 0, z: 3.2 }]);
    expect(knives.flyingCount).toBe(1);
    expect(knives.drawnCount).toBe(0);
  });

  it('flies a knife on through anyone it spares, still drawn, still hitting anyone else', () => {
    const knives = new Knives();
    const at = (id: number) => [{ id, x: 0, y: 0, z: 3.2 }];
    // Thrower 7 spares cook 2.
    const spares = (from: number, to: number) => from === 7 && to === 2;
    knives.launch(1, 7, 0, launchKnife(0, 1.62, 5.6, 0, -0.1), false, 0);
    for (let i = 0; i < 20; i++) knives.update(1 / 60, at(2), spares);
    expect(knives.flyingCount).toBe(1);
    expect(knives.drawnCount).toBe(1);
    // Someone else in its path is another matter.
    knives.launch(2, 7, 1, launchKnife(0, 1.62, 5.6, 0, -0.1), false, 0);
    for (let i = 0; i < 20; i++) knives.update(1 / 60, at(3), spares);
    // Only the first is drawn, landed somewhere beyond; the second has gone into cook 3.
    expect(knives.flyingCount).toBe(2);
    expect(knives.drawnCount).toBe(1);
  });

  describe('a knife the server says flew on past a cook drawn in its way', () => {
    // On the server another knife hit the cook first, that tick, so this one went on through.
    const throwAt = () => launchKnife(0, 1.62, 5.6, 0, -0.1);
    const cook = [{ id: 2, x: 0, y: 0, z: 3.2 }];
    /** Where the server, flying a tick at a time through nobody, has the knife stick. */
    const verdict = (id: number) => {
      const knife = throwAt();
      for (;;) {
        const impact = flyKnife(knife, TICK_SECONDS, [], 1);
        if (impact?.kind === 'surface') {
          const { x, y, z, dx, dy, dz, t } = impact;
          return { kind: 'stuck' as const, knife: { id, x, y, z, dx, dy, dz }, at: t };
        }
      }
    };

    it('comes back out of them, if it had gone in here before the word came', () => {
      const knives = new Knives();
      knives.throwOwn(5, 1, throwAt(), true);
      knives.launch(9, 1, 5, throwAt(), true, 0);
      for (let i = 0; i < 6; i++) knives.update(1 / 60, cook);
      expect(knives.drawnCount).toBe(0);
      knives.resolve(9, verdict(9));
      knives.update(1 / 60, cook);
      expect(knives.drawnCount).toBe(1);
      for (let i = 0; i < 60; i++) knives.update(1 / 60, cook);
      expect(knives.stuckKnives().map((k) => k.id)).toEqual([9]);
      expect(knives.maxCorrection).toBeLessThan(1e-3);
    });

    it('flies straight through them, if the word came first', () => {
      const knives = new Knives();
      // Someone else's knife, drawn as far in the past as they are.
      knives.launch(9, 1, 0, throwAt(), false, 0.1);
      knives.resolve(9, verdict(9));
      for (let i = 0; i < 6; i++) knives.update(1 / 60, cook);
      for (let i = 0; i < 60 && knives.flyingCount > 0; i++) {
        knives.update(1 / 60, cook);
        expect(knives.drawnCount).toBe(1);
      }
      expect(knives.stuckKnives().map((k) => k.id)).toEqual([9]);
      expect(knives.maxCorrection).toBeLessThan(1e-3);
    });
  });

  it('asks afresh every frame, so a change of mind mid-flight shows at once', () => {
    const knives = new Knives();
    let spared = false;
    knives.launch(1, 7, 0, launchKnife(0, 1.62, 5.6, 0, -0.1), false, 0);
    knives.update(1 / 60, [{ id: 2, x: 0, y: 0, z: 3.2 }], () => spared);
    spared = true;
    for (let i = 0; i < 20; i++)
      knives.update(1 / 60, [{ id: 2, x: 0, y: 0, z: 3.2 }], () => spared);
    expect(knives.drawnCount).toBe(1);
  });
});
