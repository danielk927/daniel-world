import { describe, expect, it } from 'vitest';
import { KNIFE_MAX_STUCK, launchKnife, type StuckKnife } from '@world/shared';
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
    expect(knives.mesh.count).toBe(1);
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

  it('holds back a remote knife until it leaves the thrower as drawn', () => {
    const knives = new Knives();
    knives.launch(1, 2, 0, intoFloor(), false, 0.1);
    knives.update(1 / 20, []);
    expect(knives.mesh.count).toBe(0);
    knives.update(1 / 10, []);
    expect(knives.mesh.count).toBe(1);
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
    expect(knives.mesh.count).toBe(KNIFE_MAX_STUCK);
  });

  it('lets a knife flying at a player vanish into them on screen while the server decides', () => {
    const knives = new Knives();
    knives.throwOwn(0, 1, launchKnife(0, 1.62, 5.6, 0, -0.1), true);
    for (let i = 0; i < 20; i++) knives.update(1 / 60, [{ id: 2, x: 0, y: 0, z: 3.2 }]);
    expect(knives.flyingCount).toBe(1);
    expect(knives.mesh.count).toBe(0);
  });
});
