import { Vector3, type Object3D, type SkinnedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import { KNIFE_SKINS, knifeLook, type KnifeSkin } from '@world/shared';
import { FINGERS, FINGER_STRIDE, segmentDistance } from './hand.ts';
import { knifeModel } from './knifeModel.ts';
import { knifeMoves } from './knifeMoves.ts';
import { Viewmodel, handleAt, knifeHand } from './viewmodel.ts';

/**
 * The hand on screen holding each knife, checked in the scene the renderer draws: the knife's own
 * meshes against the hand's bones, as the view model poses them.
 */

const camera = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };

function holding(skin: KnifeSkin): Viewmodel {
  const vm = new Viewmodel();
  vm.setLook(knifeLook(skin, undefined));
  vm.setShown(true);
  step(vm, 1.5);
  return vm;
}

function step(vm: Viewmodel, seconds: number): void {
  for (let t = 0; t < seconds; t += 1 / 60) vm.update(1 / 60, camera as never, 0, 0, 0, true);
}

const parts = (vm: Viewmodel) =>
  vm as unknown as { model: Object3D; hand: { mesh: SkinnedMesh }; arm: Object3D };

/** The index finger's proximal phalanx, in world space: its knuckle and middle joint's bones. */
function indexProximal(vm: Viewmodel): [Vector3, Vector3] {
  const bones = parts(vm).hand.mesh.skeleton.bones;
  // The wrist, then the index finger's metacarpal, knuckle and middle joint.
  return [bones[2]!.getWorldPosition(new Vector3()), bones[3]!.getWorldPosition(new Vector3())];
}

/** How far a knife's ring is from the index finger's proximal phalanx, in the arm's own units. */
function ringOffFinger(vm: Viewmodel, skin: KnifeSkin): number {
  vm.scene.updateMatrixWorld(true);
  const [pz, py] = knifeModel(skin).pivot;
  const ring = parts(vm).model.localToWorld(new Vector3(0, py, pz));
  const [knuckle, joint] = indexProximal(vm);
  const scale = parts(vm).arm.getWorldScale(new Vector3()).x;
  return segmentDistance(ring, ring, knuckle, joint) / scale;
}

/** How far a ring's hole leans off the finger through it. */
function ringLean(vm: Viewmodel): number {
  vm.scene.updateMatrixWorld(true);
  const model = parts(vm).model;
  const hole = new Vector3(1, 0, 0).transformDirection(model.matrixWorld);
  const [knuckle, joint] = indexProximal(vm);
  const finger = joint.sub(knuckle).normalize();
  return Math.acos(Math.min(1, Math.abs(hole.dot(finger))));
}

describe('the hand round each knife', () => {
  for (const skin of KNIFE_SKINS) {
    it(`holds the ${skin} with the wrist bent no further than a wrist goes`, () => {
      const hand = knifeHand(knifeModel(skin));
      const reach = new Vector3(0, 0, -1).applyQuaternion(hand.placement.quaternion);
      const forearm = new Vector3(0, 0, -1).applyQuaternion(hand.forearm);
      expect((reach.angleTo(forearm) * 180) / Math.PI).toBeLessThan(25);
    });

    it(`runs the ${skin}'s handle through the fist`, () => {
      const model = knifeModel(skin);
      const hand = knifeHand(model);
      // Every finger but a ring-threading index wraps the handle: the hand's handle axis, placed,
      // lies on the knife's own handle.
      const { grip, placement } = hand;
      const axis = grip.axis.clone().applyQuaternion(placement.quaternion);
      const center = grip.center
        .clone()
        .applyQuaternion(placement.quaternion)
        .add(placement.position);
      const knifeAxis = new Vector3(0, 0, 1).applyQuaternion(
        (parts(holding(skin)).model.parent!.parent!.parent as Object3D).quaternion,
      );
      expect(Math.abs(axis.dot(knifeAxis))).toBeGreaterThan(Math.cos(0.01));
      const vm = holding(skin);
      vm.scene.updateMatrixWorld(true);
      const [gz] = model.grip;
      const section = handleAt(model, gz);
      const middle = parts(vm)
        .arm.worldToLocal(parts(vm).model.localToWorld(new Vector3(0, section.y, gz)))
        .sub(center);
      expect(middle.projectOnPlane(axis).length()).toBeLessThan(0.001);
    });
  }

  it("threads the karambit's ring on the index finger, at rest and all through its spin", () => {
    const vm = holding('karambit');
    expect(ringOffFinger(vm, 'karambit')).toBeLessThan(0.002);
    expect(ringLean(vm)).toBeLessThan(0.62);
    vm.startInspect();
    const inspect = knifeMoves('karambit').inspect.duration;
    for (let t = 0; t < inspect; t += 0.1) {
      step(vm, 0.1);
      expect(ringOffFinger(vm, 'karambit')).toBeLessThan(0.002);
    }
  });

  for (const skin of ['talon', 'skeleton'] as const) {
    it(`hangs the ${skin} by its ring from the index finger when it is spun`, () => {
      const vm = holding(skin);
      vm.startInspect();
      // Hanging from its ring, mid-spin.
      step(vm, 1.65);
      expect(ringOffFinger(vm, skin)).toBeLessThan(0.001);
      expect(ringLean(vm)).toBeLessThan(0.05);
    });
  }

  it('lets go of the handle while a knife spins, and closes on it again', () => {
    const vm = holding('karambit');
    const little = FINGERS.length - 1;
    const curl = (): number => {
      const pose = (vm as unknown as { handPose: Float32Array }).handPose;
      // The little finger's knuckle bend.
      return pose[little * FINGER_STRIDE + 2]!;
    };
    const gripped = curl();
    vm.startInspect();
    let loosest = gripped;
    for (let t = 0; t < 2.2; t += 1 / 60) {
      step(vm, 1 / 60);
      loosest = Math.min(loosest, curl());
    }
    expect(loosest).toBeLessThan(gripped - 0.3);
    step(vm, knifeMoves('karambit').inspect.duration);
    expect(curl()).toBeCloseTo(gripped, 2);
  });
});
