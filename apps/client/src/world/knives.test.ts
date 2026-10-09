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
