import { Matrix4, Vector3, type InstancedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import { EYE_HEIGHT } from '@world/shared';
import { Avatars, RECOIL_SECONDS, recoil, type AvatarPose } from './avatars.ts';

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

describe('the recoil of a cook a knife has hit', () => {
  it('is nothing before the hit and after it has settled', () => {
    expect(recoil(-1)).toBe(0);
    expect(recoil(0)).toBe(0);
    expect(recoil(RECOIL_SECONDS)).toBe(0);
    expect(recoil(RECOIL_SECONDS * 10)).toBe(0);
    expect(recoil(-Infinity)).toBe(0);
  });

  it('snaps back fast, to the most, and settles slower', () => {
    const samples = Array.from({ length: 33 }, (_, i) => recoil((i / 32) * RECOIL_SECONDS));
    const peak = Math.max(...samples);
    expect(peak).toBeGreaterThan(0.99);
    expect(recoil(RECOIL_SECONDS * 0.2)).toBeCloseTo(1, 9);
    // Peaks in the first third, so it reads as a knock, and eases back the rest of the way.
    expect(samples.indexOf(peak)).toBeLessThan(11);
    for (let i = samples.indexOf(peak); i < samples.length - 1; i++) {
      expect(samples[i + 1]!).toBeLessThanOrEqual(samples[i]! + 1e-9);
    }
    for (const sample of samples) {
      expect(sample).toBeGreaterThanOrEqual(0);
      expect(sample).toBeLessThanOrEqual(1);
    }
  });

  it('tips a hit cook back, and only until it has settled', () => {
    const avatars = new Avatars(2);
    avatars.add(1, '#e8553a');
    const bodyTilt = (time: number): number => {
      avatars.update(1, standing(0, 0), time, 1 / 60);
      // The first mesh in the group is the bodies.
      const bodies = avatars.group.children[0] as InstancedMesh;
      const m = new Matrix4();
      bodies.getMatrixAt(0, m);
      // How far the body's up axis points toward +z: leaning back tips it that way (the cook faces -z).
      return m.elements[6] ?? 0;
    };
    const upright = bodyTilt(0);
    avatars.playHit(1, 10);
    const struck = bodyTilt(10 + RECOIL_SECONDS * 0.2);
    expect(struck).toBeGreaterThan(upright + 0.1);
    expect(bodyTilt(10 + RECOIL_SECONDS + 0.01)).toBeCloseTo(upright, 6);
  });
});
