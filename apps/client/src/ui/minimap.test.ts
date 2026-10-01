import { describe, expect, it } from 'vitest';
import { ISLAND_RADIUS } from '@world/shared';
import { worldToMap } from './minimap.ts';

describe('worldToMap', () => {
  it('puts the island center in the middle of the map', () => {
    expect(worldToMap(0, 0)).toEqual({ x: 88, y: 88 });
  });

  it('keeps north (-Z) up and east (+X) right', () => {
    const north = worldToMap(0, -10);
    const east = worldToMap(10, 0);
    expect(north.y).toBeLessThan(88);
    expect(north.x).toBe(88);
    expect(east.x).toBeGreaterThan(88);
    expect(east.y).toBe(88);
  });

  it('fits the whole island inside the map with a margin', () => {
    const edge = worldToMap(ISLAND_RADIUS, 0);
    // 176 px map, 8 px margin on each side.
    expect(edge.x).toBeCloseTo(176 - 8);
  });
});
