import { Matrix4, Vector3, type InstancedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT } from '@world/shared';
import { Avatars, type AvatarPose } from './avatars.ts';

const standing = (x: number, z: number): AvatarPose => ({
  x,
  y: 0,
  z,
  yaw: 0,
  pitch: 0,
  grounded: true,
  dead: false,
  armed: true,
  speed: 0,
});

/** Whether the cook in `slot` is drawn this frame: every part of them, or none. */
function drawn(avatars: Avatars, slot: number): boolean {
  const meshes = avatars.group.children as InstancedMesh[];
  const m = new Matrix4();
  const parts = meshes
    .filter((mesh) => mesh.visible)
    .map((mesh) => {
      // Hands and eyes come two to a cook, buttons six; slot `slot` owns the first of its run.
      const per = mesh.count / 4;
      mesh.getMatrixAt(slot * per, m);
      return m.determinant() !== 0;
    });
  expect(new Set(parts).size, 'all of the cook or none of them').toBe(1);
  return parts[0]!;
}

describe('the cooks on screen', () => {
  it('leave out, for the frame, one the camera is inside, as when a cook walks through you', () => {
    const avatars = new Avatars(4);
    avatars.add(1, '#e8553a');
    avatars.add(2, '#4fb3ff');
    const pose = (x: number) => {
      avatars.update(1, standing(x, 0), 0, 1 / 60);
      avatars.update(2, standing(3, 0), 0, 1 / 60);
    };
    // Walking through the camera, at a visitor's eye height.
    const eye = new Vector3(0, EYE_HEIGHT, 0);
    for (const [x, inside] of [
      [-1, false],
      [-0.6, false],
      [-0.3, true],
      [0, true],
      [0.3, true],
      [0.6, false],
    ] as const) {
      pose(x);
      avatars.hideAround(eye);
      expect(drawn(avatars, 0), `cook at x ${x}`).toBe(!inside);
      expect(drawn(avatars, 1), 'the cook further off').toBe(true);
    }
  });
});
