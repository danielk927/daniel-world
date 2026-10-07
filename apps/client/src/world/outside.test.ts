import { Box3, FrontSide, Mesh, MeshBasicMaterial, Ray, Raycaster, Vector3 } from 'three';
import {
  COOLER,
  COOLER_WALL,
  EYE_HEIGHT,
  PLAY_HALF_X,
  PLAY_HALF_Z,
  ROOM_HALF_Z,
  WINDOWS,
} from '@world/shared';
import { describe, expect, it } from 'vitest';
import { SKYLIGHT_OPENINGS } from './kitchen.ts';
import { SKY_CENTER, SKY_RADIUS, landHeight, paintOutside } from './outside.ts';
import { lookAt } from './timeOfDay.ts';

const outside = paintOutside(lookAt(19.8));
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

  it('fills the skylights, seen from anywhere on the floor', () => {
    const misses: string[] = [];
    const point = new Vector3();
    for (const x of [-PLAY_HALF_X, -3, 0, 3, PLAY_HALF_X]) {
      for (const z of [-PLAY_HALF_Z, -2, 2, PLAY_HALF_Z]) {
        const eye = new Vector3(x, EYE_HEIGHT, z);
        for (const [a, b, , d] of SKYLIGHT_OPENINGS) {
          for (let i = 0; i <= 6; i++) {
            for (const v of [0.05, 0.5, 0.95]) {
              // A point in the opening, across its length and its width.
              point
                .copy(a!)
                .lerp(b!, i / 6)
                .addScaledVector(d!.clone().sub(a!), v);
              if (!sees(point, point.clone().sub(eye))) misses.push(`${x}, ${z} -> ${i}, ${v}`);
            }
          }
        }
      }
    }
    expect(misses).toEqual([]);
  });

  it('keeps everything under the sky, so no summit is cut off by the dome', () => {
    const position = outside.geometry.getAttribute('position');
    const point = new Vector3();
    let farthest = 0;
    for (let i = 0; i < position.count; i++) {
      farthest = Math.max(farthest, point.fromBufferAttribute(position, i).distanceTo(SKY_CENTER));
    }
    expect(farthest).toBeLessThanOrEqual(SKY_RADIUS + 1e-3);
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

  it('never shows the walk-in cooler, which stands behind the east wall', () => {
    // The cooler, walls and all, lies south of the window wall, so no sight line through a pane can
    // reach it, and nothing of the view outside is built inside it.
    const box = new Box3(
      new Vector3(COOLER.minX - COOLER_WALL, 0, COOLER.minZ - COOLER_WALL),
      new Vector3(
        COOLER.maxX + COOLER_WALL,
        COOLER.height + COOLER_WALL,
        COOLER.maxZ + COOLER_WALL,
      ),
    );
    expect(box.min.z).toBeGreaterThan(-ROOM_HALF_Z);
    const ray = new Ray();
    for (const x of [-PLAY_HALF_X, 0, PLAY_HALF_X]) {
      const eye = new Vector3(x, EYE_HEIGHT, -5.45);
      for (let i = 0; i <= 12; i++) {
        const pane = new Vector3(
          WINDOWS.from + ((WINDOWS.to - WINDOWS.from) * i) / 12,
          2,
          -ROOM_HALF_Z,
        );
        ray.set(pane, pane.clone().sub(eye).normalize());
        expect(ray.intersectsBox(box)).toBe(false);
      }
    }
    const position = outside.geometry.getAttribute('position');
    const point = new Vector3();
    for (let i = 0; i < position.count; i++) {
      expect(box.containsPoint(point.fromBufferAttribute(position, i))).toBe(false);
    }
  });

  it('is flat by the kitchen and rises to mountains at the edge', () => {
    expect(Math.abs(landHeight(0, -12) - landHeight(20, -25))).toBeLessThan(0.01);
    for (let i = 0; i <= 8; i++) {
      const t = -Math.PI / 2 + (i / 8) * Math.PI;
      expect(landHeight(Math.sin(t) * 160, WALL_OUTSIDE - Math.cos(t) * 160)).toBeGreaterThan(10);
    }
  });
});
