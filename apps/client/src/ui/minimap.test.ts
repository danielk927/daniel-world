import { describe, expect, it } from 'vitest';
import { COOLER, DOORS, ROOM_HALF_X, ROOM_HALF_Z, STATIONS } from '@world/shared';
import { MAP_SIZE, PLAN_RADIUS, kitchenPlan, mapView, worldToMap, type Plan } from './minimap.ts';

const MIDDLE = MAP_SIZE / 2;

/** Every point the map draws for a plan: line ends, footprint corners, stations. */
function points(plan: Plan): [number, number][] {
  return [
    ...[...plan.walls, ...plan.doors].flatMap(([x0, z0, x1, z1]): [number, number][] => [
      [x0, z0],
      [x1, z1],
    ]),
    ...plan.fixtures.flatMap((f): [number, number][] => [
      [f.minX, f.minZ],
      [f.maxX, f.minZ],
      [f.minX, f.maxZ],
      [f.maxX, f.maxZ],
    ]),
    ...plan.stations.map((s): [number, number] => [s.x, s.z]),
  ];
}

/** How far from the middle of the disc the farthest thing drawn lands, in pixels. */
function reach(coolerOpen: boolean): number {
  const view = mapView(coolerOpen);
  return Math.max(
    ...points(kitchenPlan(coolerOpen)).map(([x, z]) => {
      const p = worldToMap(x, z, view);
      return Math.hypot(p.x - MIDDLE, p.y - MIDDLE);
    }),
  );
}

describe('worldToMap', () => {
  it('puts the kitchen center in the middle of the disc', () => {
    expect(worldToMap(0, 0)).toEqual({ x: MIDDLE, y: MIDDLE });
  });

  it('keeps north (-Z) up and east (+X) right', () => {
    const north = worldToMap(0, -5);
    const east = worldToMap(5, 0);
    expect(north.y).toBeLessThan(MIDDLE);
    expect(north.x).toBe(MIDDLE);
    expect(east.x).toBeGreaterThan(MIDDLE);
    expect(east.y).toBe(MIDDLE);
  });

  it('fits the whole kitchen inside the disc, its corners just clear of the ring', () => {
    expect(reach(false)).toBeCloseTo(PLAN_RADIUS);
    const corner = worldToMap(ROOM_HALF_X, ROOM_HALF_Z);
    expect(Math.hypot(corner.x - MIDDLE, corner.y - MIDDLE)).toBeCloseTo(PLAN_RADIUS);
    expect(PLAN_RADIUS).toBeLessThan(MIDDLE - 8);
  });

  it('makes room for the walk-in once it is open, the cooler inside the disc too', () => {
    expect(reach(true)).toBeLessThanOrEqual(PLAN_RADIUS + 1e-9);
    const view = mapView(true);
    expect(view.scale).toBeLessThan(mapView(false).scale);
    // Still in the middle from north to south.
    const west = worldToMap(-ROOM_HALF_X, -ROOM_HALF_Z, view);
    const east = worldToMap(COOLER.maxX, ROOM_HALF_Z, view);
    expect(west.y + east.y).toBeCloseTo(MAP_SIZE);
    expect(west.x + east.x).toBeCloseTo(MAP_SIZE);
  });
});

describe('kitchenPlan', () => {
  it('breaks the walls at every door, and shows the shut ones across their openings', () => {
    const plan = kitchenPlan(false);
    expect(plan.doors).toHaveLength(Object.keys(DOORS).length);
    // The four walls, each once more for every door in it.
    expect(plan.walls).toHaveLength(4 + Object.keys(DOORS).length);
    expect(plan.stations).toHaveLength(STATIONS.length);
  });

  it('opens the walk-in into the cold room once its door has burst', () => {
    const shut = kitchenPlan(false);
    const open = kitchenPlan(true);
    expect(open.doors).toHaveLength(shut.doors.length - 1);
    expect(open.walls.length).toBeGreaterThan(shut.walls.length);
    expect(open.fixtures.length).toBeGreaterThan(shut.fixtures.length);
    const east = open.walls.flatMap(([x0, , x1]) => [x0, x1]);
    expect(Math.max(...east)).toBe(COOLER.maxX);
  });
});
