import { describe, expect, it } from 'vitest';
import { ROOM_HALF_X, ROOM_HALF_Z } from '@world/shared';
import { MAP_HEIGHT, MAP_WIDTH, worldToMap } from './minimap.ts';

describe('worldToMap', () => {
  it('puts the kitchen center in the middle of the map', () => {
    expect(worldToMap(0, 0)).toEqual({ x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 });
  });

  it('keeps north (-Z) up and east (+X) right', () => {
    const north = worldToMap(0, -5);
    const east = worldToMap(5, 0);
    expect(north.y).toBeLessThan(MAP_HEIGHT / 2);
    expect(north.x).toBe(MAP_WIDTH / 2);
    expect(east.x).toBeGreaterThan(MAP_WIDTH / 2);
    expect(east.y).toBe(MAP_HEIGHT / 2);
  });

  it('fits the whole kitchen inside the map with a margin', () => {
    const corner = worldToMap(ROOM_HALF_X, ROOM_HALF_Z);
    expect(corner.x).toBeCloseTo(MAP_WIDTH - 8);
    expect(corner.y).toBeGreaterThan(MAP_HEIGHT - 9);
    expect(corner.y).toBeLessThanOrEqual(MAP_HEIGHT - 7);
  });
});
