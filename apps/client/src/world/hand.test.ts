import { MeshBasicMaterial, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import {
  FINGERS,
  FINGER_STRIDE,
  FIST_POSE,
  HandRig,
  OPEN_POSE,
  PALM_HALF_THICKNESS,
  POSE_SIZE,
  SEGMENT_COUNT,
  gripPose,
  handPose,
  handSegments,
  lineDistance,
  segmentDistance,
  segments,
  type HandPose,
} from './hand.ts';

const THUMB = SEGMENT_COUNT - 3;

describe('the hand', () => {
  it('bends its mesh exactly as its kinematics say', () => {
    const rig = new HandRig(new MeshBasicMaterial());
    const segs = segments();
    let seed = 7;
    const random = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
    for (let n = 0; n < 20; n++) {
      const pose = handPose(Array.from({ length: POSE_SIZE }, () => random() * 1.4));
      rig.pose(pose);
      rig.mesh.updateMatrixWorld(true);
      handSegments(pose, segs);
      // Bones: the wrist, then each finger's metacarpal and three joints, then the thumb's three.
      const bones = rig.mesh.skeleton.bones;
      for (let s = 0; s < SEGMENT_COUNT; s++) {
        const f = Math.floor(s / 3);
        const bone =
          f < FINGERS.length ? 1 + f * 4 + 1 + (s % 3) : 1 + FINGERS.length * 4 + (s % 3);
        const joint = bones[bone]!.getWorldPosition(new Vector3());
        expect(joint.distanceTo(segs[s]!.start)).toBeLessThan(1e-6);
      }
    }
  });

  it('is one draw call', () => {
    const rig = new HandRig(new MeshBasicMaterial());
    expect(rig.mesh.children.filter((c) => (c as { isMesh?: boolean }).isMesh)).toEqual([]);
    expect(rig.mesh.skeleton.bones).toHaveLength(1 + FINGERS.length + SEGMENT_COUNT);
  });

  for (const radius of [0.007, 0.0095, 0.012, 0.0145]) {
    describe(`gripping a handle ${(radius * 2000).toFixed(0)} mm thick`, () => {
      const grip = gripPose(radius);
      const segs = handSegments(grip.pose, segments());

      it('wraps every finger round it, each phalanx touching it and none sinking in', () => {
        FINGERS.forEach((finger, f) => {
          const c = grip.through[f]!;
          const touch = radius + finger.radius;
          if (grip.touch[f]! < 0) {
            // Tucked into the palm beside a handle it cannot reach round, and clear of it.
            for (let j = 0; j < 3; j++) {
              const s = segs[f * 3 + j]!;
              const gap = lineDistance(s.start, s.end, grip.center, grip.axis);
              expect(gap).toBeGreaterThan(touch - 0.001);
            }
            return;
          }
          // A fingertip eased off the palm may stand clear of the handle; the rest touch it.
          const eased = grip.pose[f * FINGER_STRIDE + 4]! < 1e-6;
          for (let j = 0; j < 3; j++) {
            const s = segs[f * 3 + j]!;
            const nearest = segmentDistance(s.start, s.end, c, c);
            expect(nearest).toBeGreaterThan(touch - 2e-4);
            if (j < 2 || !eased) expect(nearest).toBeLessThan(touch + 2e-4);
          }
        });
      });

      it('runs it straight through the fist, across the palm on a slant', () => {
        // Each finger wraps it exactly where it crosses that finger.
        for (const c of grip.through) {
          expect(lineDistance(c, c, grip.center, grip.axis)).toBeLessThan(1e-4);
        }
        // From the little finger's side toward the index finger, leaning toward the fingers.
        expect(grip.axis.y).toBeGreaterThan(0.75);
        expect(grip.axis.z).toBeLessThan(-0.3);
        // All four fingers wrap it.
        expect(grip.touch.every((t) => t > 0)).toBe(true);
      });

      it('keeps the fingertips out of the palm', () => {
        FINGERS.forEach((finger, f) => {
          const tip = segs[f * 3 + 2]!;
          const overPalm = tip.end.z > finger.base[2];
          if (overPalm) {
            expect(tip.end.x).toBeLessThan(-PALM_HALF_THICKNESS - tip.radius * 0.5);
          }
        });
      });

      it('closes the thumb over the fingers, out of them and out of the handle', () => {
        expectThumbClear(
          grip.pose,
          (s) => lineDistance(s.start, s.end, grip.center, grip.axis) - radius - s.radius,
        );
        // Resting on the fingers, not off in the air: its last phalanx lies against one of them.
        const tip = segs[THUMB + 2]!;
        let nearest = Infinity;
        for (let f = 0; f < FINGERS.length * 3; f++) {
          const s = segs[f]!;
          nearest = Math.min(
            nearest,
            segmentDistance(tip.start, tip.end, s.start, s.end) - tip.radius - s.radius,
          );
        }
        expect(nearest).toBeLessThan(0.004);
      });
    });
  }

  it('tucks a finger into the palm beside a handle it cannot reach round', () => {
    // So steep across the palm that it runs out past the heel of the hand under the little finger.
    const grip = gripPose(0.004, 1.15);
    const segs = handSegments(grip.pose, segments());
    expect(grip.touch[3]).toBe(-1);
    for (let j = 0; j < 3; j++) {
      const s = segs[3 * 3 + j]!;
      const gap = lineDistance(s.start, s.end, grip.center, grip.axis);
      expect(gap).toBeGreaterThan(grip.radius + FINGERS[3]!.radius - 0.001);
    }
  });

  it('makes a fist with the thumb across the fingers, and opens with it beside them', () => {
    expectThumbClear(FIST_POSE);
    expectThumbClear(OPEN_POSE);
    const fist = handSegments(FIST_POSE, segments());
    const open = handSegments(OPEN_POSE, segments());
    // Clenched, the fingertips are back over the palm; open, they reach well past the knuckles.
    for (let f = 0; f < FINGERS.length; f++) {
      expect(fist[f * 3 + 2]!.end.z).toBeGreaterThan(FINGERS[f]!.base[2] - 0.02);
      expect(open[f * 3 + 2]!.end.z).toBeLessThan(FINGERS[f]!.base[2] - 0.04);
    }
    // At rest the thumb lies along the index finger's side, toward the palm.
    const thumbTip = open[THUMB + 2]!.end;
    expect(thumbTip.y).toBeGreaterThan(FINGERS[0]!.base[1]);
    expect(thumbTip.x).toBeLessThan(0);
  });

  it('measures segments against each other', () => {
    const o = new Vector3();
    expect(
      segmentDistance(o, new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(1, 1, 0)),
    ).toBeCloseTo(1);
    expect(
      segmentDistance(
        new Vector3(-1, 0, 0),
        new Vector3(1, 0, 0),
        new Vector3(0, -1, 1),
        new Vector3(0, 1, 1),
      ),
    ).toBeCloseTo(1);
    expect(segmentDistance(o, o, new Vector3(3, 4, 0), new Vector3(3, 4, 0))).toBeCloseTo(5);
  });
});

/** The thumb's phalanges keep out of every finger, and of a handle if `handleGap` says so. */
function expectThumbClear(
  pose: HandPose,
  handleGap?: (s: { start: Vector3; end: Vector3; radius: number }) => number,
): void {
  const segs = handSegments(pose, segments());
  for (let j = 1; j < 3; j++) {
    const t = segs[THUMB + j]!;
    for (let s = 0; s < FINGERS.length * 3; s++) {
      const f = segs[s]!;
      const gap = segmentDistance(t.start, t.end, f.start, f.end) - (t.radius + f.radius);
      expect(gap).toBeGreaterThan(-(t.radius + f.radius) * 0.12);
    }
    if (handleGap) expect(handleGap(t)).toBeGreaterThan(-0.0015);
  }
}
