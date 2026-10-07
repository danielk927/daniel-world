import { describe, expect, it } from 'vitest';
import { KNIFE_EMBED, KNIFE_MAX_FLIGHT_SECONDS, KNIFE_SPEED, ROOM_HEIGHT } from './constants.ts';
import { flyKnife, launchKnife, type KnifeImpact, type KnifeTarget } from './knife.ts';
import { COMPUTER, KITCHEN, vaultHeight } from './world.ts';

/** Throw from an eye position and fly until something is hit (or the flight runs out). */
function throwFrom(
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  targets: readonly KnifeTarget[] = [],
  thrower = -1,
): KnifeImpact | null {
  const knife = launchKnife(x, y, z, yaw, pitch);
  for (let i = 0; i < 200; i++) {
    const impact = flyKnife(knife, 1 / 20, targets, thrower);
    if (impact) return impact;
    if (knife.t >= KNIFE_MAX_FLIGHT_SECONDS) return null;
  }
  return null;
}

const NORTH = 0;
const EAST = -Math.PI / 2;
const WEST = Math.PI / 2;
const DOWN = -Math.PI / 2 + 0.01;
const UP = Math.PI / 2 - 0.01;

describe('knife flight', () => {
  it('leaves the eye at throwing speed, along the view direction', () => {
    const k = launchKnife(1, 1.6, 2, NORTH, 0);
    expect([k.x, k.y, k.z]).toEqual([1, 1.6, 2]);
    expect(k.vx).toBeCloseTo(0);
    expect(k.vz).toBeCloseTo(-KNIFE_SPEED);
    const east = launchKnife(0, 1.6, 0, EAST, 0);
    expect(east.vx).toBeCloseTo(KNIFE_SPEED);
  });

  it('sticks into the floor, blade first, a little below the surface', () => {
    // The aisle between the piano and the pass is clear floor.
    const hit = throwFrom(0, 1.6, 2.6, NORTH, DOWN);
    expect(hit?.kind).toBe('surface');
    if (hit?.kind !== 'surface') return;
    expect(hit.y).toBeCloseTo(-KNIFE_EMBED * Math.abs(hit.dy), 2);
    expect(hit.dy).toBeLessThan(-0.99);
    expect(hit.z).toBeCloseTo(2.6, 1);
  });

  it('sticks into the kitchen computer, not the wall behind it', () => {
    // Thrown west at the screen from the aisle by the desk.
    const hit = throwFrom(-6.3, COMPUTER.y + 0.05, COMPUTER.z, WEST, 0);
    expect(hit?.kind).toBe('surface');
    if (hit?.kind !== 'surface') return;
    expect(hit.x).toBeGreaterThan(COMPUTER.x - 0.1);
    expect(hit.x).toBeLessThan(COMPUTER.x);
  });

  it('sticks into the face of a fixture it flies into', () => {
    // Thrown east along the aisle at chest height, it meets the open shelving on the east wall.
    const hit = throwFrom(4, 1.5, 2.6, EAST, 0);
    expect(hit?.kind).toBe('surface');
    if (hit?.kind !== 'surface') return;
    expect(hit.x).toBeCloseTo(KITCHEN.shelving.minX + KNIFE_EMBED, 2);
    expect(hit.dx).toBeGreaterThan(0.99);
  });

  it('drops a little on a long throw and can land on a counter top', () => {
    // Level from the dining room side, across the pass and over the piano.
    const hit = throwFrom(0, 1.62, 5.6, NORTH, 0);
    expect(hit?.kind).toBe('surface');
    if (hit?.kind !== 'surface') return;
    expect(hit.y).toBeLessThan(1.62);
    expect(hit.dy).toBeLessThan(0);
  });

  it('sticks into the hood from below and the vault from below', () => {
    const hood = throwFrom(0, 1.6, 0, NORTH, UP);
    expect(hood?.kind === 'surface' && hood.y).toBeCloseTo(KITCHEN.hood.bottom + KNIFE_EMBED, 2);
    const vault = throwFrom(0, 1.6, 5, NORTH, UP);
    expect(vault?.kind).toBe('surface');
    if (vault?.kind !== 'surface') return;
    expect(vault.y).toBeGreaterThan(ROOM_HEIGHT);
    expect(vault.y).toBeCloseTo(vaultHeight(vault.z) + KNIFE_EMBED * vault.dy, 2);
  });

  it('hits a player it passes through, and never the thrower', () => {
    const target: KnifeTarget = { id: 7, x: 0, y: 0, z: 3 };
    const hit = throwFrom(0, 1.62, 5.6, NORTH, -0.1, [target]);
    expect(hit).toMatchObject({ kind: 'player', id: 7 });
    if (hit?.kind !== 'player') return;
    expect(hit.z).toBeGreaterThan(3);
    // Standing in the knife's way, but it is their own knife.
    const own = throwFrom(0, 1.62, 5.6, NORTH, -0.1, [{ ...target, id: 3 }], 3);
    expect(own?.kind).toBe('surface');
  });

  it('misses a player it flies over or past', () => {
    const target: KnifeTarget = { id: 7, x: 0, y: 0, z: 3 };
    expect(throwFrom(0, 1.62, 5.6, NORTH, 0.6, [target])?.kind).toBe('surface');
    expect(throwFrom(0.6, 1.62, 5.6, NORTH, -0.1, [target])?.kind).toBe('surface');
  });

  it('is deterministic, so every client can replay a flight the server announced', () => {
    const a = throwFrom(0.3, 1.62, 5.6, 0.2, 0.1);
    const b = throwFrom(0.3, 1.62, 5.6, 0.2, 0.1);
    expect(a).toEqual(b);
  });
});
