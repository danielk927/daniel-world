import { FrontSide, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from 'three';
import { EYE_HEIGHT, PLAY_HALF_X, ROOM_HALF_Z, WINDOWS } from '@world/shared';
import { describe, expect, it } from 'vitest';
import { landHeight, paintOutside } from './outside.ts';

const outside = paintOutside();
// Front faces only, as drawn: a ray that only finds the back of something sees through it.
const mesh = new Mesh(outside.geometry, new MeshBasicMaterial({ side: FrontSide }));
const raycaster = new Raycaster();
const WALL_OUTSIDE = -ROOM_HALF_Z - 0.25;

function sees(from: Vector3, direction: Vector3): boolean {
  raycaster.set(from, direction.clone().normalize());
  return raycaster.intersectObject(mesh, false).length > 0;
}

describe('the view outside', () => {
  it('fills every pane, from anywhere along the windows, even at a glance along the wall', () => {
    // The window counter keeps a cook this far from the wall.
    const z = -5.45;
    const misses: string[] = [];
    for (const x of [-PLAY_HALF_X, -4, 0, 4, PLAY_HALF_X]) {
      const eye = new Vector3(x, EYE_HEIGHT, z);
      for (let i = 0; i <= 12; i++) {
        const u = WINDOWS.from + ((WINDOWS.to - WINDOWS.from) * i) / 12;
        for (const v of [WINDOWS.bottom, (WINDOWS.bottom + WINDOWS.top) / 2, WINDOWS.top]) {
          // Where the sight line leaves the opening, on the outside face of the wall.
          const exit = new Vector3(u, v, WALL_OUTSIDE);
          if (!sees(exit, exit.clone().sub(eye))) misses.push(`${x} -> ${u.toFixed(1)}, ${v}`);
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it('closes over the top, so the skylights look into sky in every direction', () => {
    const misses: string[] = [];
    for (let i = 0; i < 64; i++) {
      // Off the dome's seams, where a ray along a shared edge can slip between two triangles.
      const azimuth = ((i + 0.37) / 64) * Math.PI * 2;
      for (const elevation of [0.15, 0.6, 1.2, 1.55]) {
        const direction = new Vector3(
          Math.cos(elevation) * Math.sin(azimuth),
          Math.sin(elevation),
          Math.cos(elevation) * Math.cos(azimuth),
        );
        for (const z of [-4, 4]) {
          if (!sees(new Vector3(0, 4.5, z), direction)) misses.push(`${i} ${elevation}`);
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it('stays outside the kitchen', () => {
    const position = outside.geometry.getAttribute('position');
    const point = new Vector3();
    for (let i = 0; i < position.count; i++) {
      point.fromBufferAttribute(position, i);
      // Only the sky dome comes round behind the building.
      if (point.z > WALL_OUTSIDE + 1e-4) expect(point.length()).toBeGreaterThan(160);
    }
    for (const bulb of outside.bulbs) expect(bulb.z).toBeLessThan(WALL_OUTSIDE);
  });

  it('is flat by the kitchen and rises to mountains at the edge', () => {
    expect(Math.abs(landHeight(0, -12) - landHeight(20, -25))).toBeLessThan(0.01);
    for (let i = 0; i <= 8; i++) {
      const t = -Math.PI / 2 + (i / 8) * Math.PI;
      expect(landHeight(Math.sin(t) * 160, WALL_OUTSIDE - Math.cos(t) * 160)).toBeGreaterThan(10);
    }
  });
});
