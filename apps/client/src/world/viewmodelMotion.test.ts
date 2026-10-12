import { Matrix4, Quaternion, Vector3, type Bone, type Object3D, type SkinnedMesh } from 'three';
import { describe, expect, it } from 'vitest';
import { KNIFE_SKINS, knifeLook, type KnifeSkin } from '@world/shared';
import { knifeModel } from './knifeModel.ts';
import { knifeMoves } from './knifeMoves.ts';
import { Viewmodel } from './viewmodel.ts';

/**
 * The knife in the hand on screen moves as a hand could move it, through every knife's draw and
 * inspect, at 60 and at 120 frames a second: it never jumps, and it never moves, turns, starts or
 * stops faster than fingers and a wrist can move it; nor do the fingers, nor the hand in view.
 *
 * The knife is followed in the hand's own frame, so the arm carrying hand and knife together (the
 * draw coming up from below the screen with a snap) does not count against it, and the hand in view
 * is followed through the inspect. What a hinge does (a blade flicked open, a butterfly's handles)
 * is the knife's own, and not followed. Each bound is on how fast something goes, and on how much
 * that changes from one frame to the next, over the frame: a jump shows in both, and grows with the
 * frame rate, where a quick but smooth move does not.
 *
 * The hand in view is bounded through its speed, acceleration and jerk, and its jerk must not grow
 * with the frame rate: a hand's acceleration does not jump (a hand is a muscle, and takes a moment
 * to push), so the jerk of a smooth move is the same at 60 Hz and at 120, where a move that
 * started or stopped on a corner, or carried on at one speed through a key and stopped dead,
 * would show twice the jerk at the higher rate. The inspects used to be eased from pose to pose with
 * cubic curves, whose acceleration jumps at every key, and to turn on the finger at up to 3.7 m/s
 * and 24 000 rad/s³.
 */

const BOUNDS = {
  /** The knife in the hand, in the hand's own frame: it does not move there at all. */
  knifeSpeed: 0.05,
  knifeAcceleration: 5,
  knifeTurn: 0.1,
  knifeTurnChange: 20,
  /** Each joint of the fingers and thumb, in the hand. */
  fingerSpeed: 1,
  fingerAcceleration: 40,
  /** The hand in view, through the inspect: how fast it goes, in m/s, and how hard it is pushed. */
  handSpeed: 1,
  handAcceleration: 10,
  handJerk: 300,
  /** How fast the hand in view turns, in rad/s, its angular acceleration and its jerk. */
  handTurn: 9,
  handTurnChange: 70,
  handTurnJerk: 1700,
} as const;
type Bound = keyof typeof BOUNDS;
/** The bounds on jerk, which must be the same at every frame rate. */
const JERKS: readonly Bound[] = ['handJerk', 'handTurnJerk'];
/** How much more jerk a smooth move may show at 120 Hz than at 60, over what finite steps add. */
const JERK_GROWTH = 1.4;

const camera = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };

interface Parts {
  model: Object3D;
  arm: Object3D;
  knifeHolder: Object3D;
  hand: { mesh: SkinnedMesh; wrist: Bone };
  scene: Object3D;
}

/** Where things are this frame, and how fast they are going. */
interface State {
  pivot: Vector3;
  knife: Quaternion;
  fingers: Vector3[];
  hand: Vector3;
  wrist: Quaternion;
  pivotSpeed?: Vector3;
  knifeTurn?: Vector3;
  fingerSpeeds?: Vector3[];
  handSpeed?: Vector3;
  handTurn?: Vector3;
  handAcceleration?: Vector3;
  handTurnChange?: Vector3;
}

/** The turn taking `from` to `to` over `dt`, as an angular velocity. */
function turnRate(from: Quaternion, to: Quaternion, dt: number): Vector3 {
  const step = to.clone().multiply(from.clone().invert());
  if (step.w < 0) step.set(-step.x, -step.y, -step.z, -step.w);
  const half = Math.acos(Math.min(1, step.w));
  const sin = Math.sin(half);
  if (sin < 1e-9) return new Vector3();
  return new Vector3(step.x, step.y, step.z).multiplyScalar((2 * half) / sin / dt);
}

/** The fastest each thing went, and when. */
class Worst {
  readonly most = new Map<Bound, { value: number; at: number }>();

  see(bound: Bound, value: number, at: number): void {
    if (value > (this.most.get(bound)?.value ?? 0)) this.most.set(bound, { value, at });
  }
}

/** Plays a move frame by frame at `hz`, measuring the knife, the fingers and the hand. */
function measure(skin: KnifeSkin, move: 'draw' | 'inspect', hz: number): Worst {
  const dt = 1 / hz;
  const vm = new Viewmodel();
  vm.setLook(knifeLook(skin, undefined));
  const parts = vm as unknown as Parts;
  const moves = knifeMoves(skin);
  const step = (): void => vm.update(dt, camera as never, 0, 0, 0, true);
  vm.setShown(true);
  let seconds = moves.draw.duration + 0.4;
  if (move === 'inspect') {
    for (let t = 0; t < moves.draw.duration + 1.5; t += dt) step();
    vm.startInspect();
    seconds = moves.inspect.duration + 0.5;
  }
  const [gz, gy] = knifeModel(skin).grip;
  const pivot = new Vector3(0, gy, gz);
  const bones = parts.hand.mesh.skeleton.bones;
  const wrist = parts.hand.wrist;
  const worst = new Worst();
  const toHand = new Matrix4();
  let last: State | null = null;
  for (let frame = 1; frame * dt <= seconds + 1e-9; frame++) {
    step();
    const t = frame * dt;
    parts.scene.updateMatrixWorld(true);
    if (!parts.knifeHolder.visible) {
      last = null;
      continue;
    }
    // In the hand's own frame, in meters as seen.
    const scale = parts.arm.getWorldScale(new Vector3()).x;
    toHand.copy(wrist.matrixWorld).invert();
    const inHand = (p: Vector3): Vector3 => p.applyMatrix4(toHand).multiplyScalar(scale);
    const wristTurn = wrist.getWorldQuaternion(new Quaternion());
    const now: State = {
      pivot: inHand(parts.model.localToWorld(pivot.clone())),
      knife: wristTurn.clone().invert().multiply(parts.model.getWorldQuaternion(new Quaternion())),
      fingers: bones.map((bone) => inHand(bone.getWorldPosition(new Vector3()))),
      hand: wrist.getWorldPosition(new Vector3()),
      wrist: wristTurn,
    };
    const before = last;
    if (before) {
      now.pivotSpeed = now.pivot.clone().sub(before.pivot).divideScalar(dt);
      now.knifeTurn = turnRate(before.knife, now.knife, dt);
      now.fingerSpeeds = now.fingers.map((f, i) =>
        f.clone().sub(before.fingers[i]!).divideScalar(dt),
      );
      now.handSpeed = now.hand.clone().sub(before.hand).divideScalar(dt);
      now.handTurn = turnRate(before.wrist, now.wrist, dt);
      worst.see('knifeSpeed', now.pivotSpeed.length(), t);
      worst.see('knifeTurn', now.knifeTurn.length(), t);
      for (const speed of now.fingerSpeeds) worst.see('fingerSpeed', speed.length(), t);
      if (move === 'inspect') {
        worst.see('handSpeed', now.handSpeed.length(), t);
        worst.see('handTurn', now.handTurn.length(), t);
      }
      const { pivotSpeed, knifeTurn, fingerSpeeds, handSpeed, handTurn } = before;
      if (pivotSpeed && knifeTurn && fingerSpeeds && handSpeed && handTurn) {
        worst.see('knifeAcceleration', now.pivotSpeed.distanceTo(pivotSpeed) / dt, t);
        worst.see('knifeTurnChange', now.knifeTurn.distanceTo(knifeTurn) / dt, t);
        now.fingerSpeeds.forEach((speed, i) =>
          worst.see('fingerAcceleration', speed.distanceTo(fingerSpeeds[i]!) / dt, t),
        );
        if (move === 'inspect') {
          now.handAcceleration = now.handSpeed.clone().sub(handSpeed).divideScalar(dt);
          now.handTurnChange = now.handTurn.clone().sub(handTurn).divideScalar(dt);
          worst.see('handAcceleration', now.handAcceleration.length(), t);
          worst.see('handTurnChange', now.handTurnChange.length(), t);
          const { handAcceleration, handTurnChange } = before;
          if (handAcceleration && handTurnChange) {
            worst.see('handJerk', now.handAcceleration.distanceTo(handAcceleration) / dt, t);
            worst.see('handTurnJerk', now.handTurnChange.distanceTo(handTurnChange) / dt, t);
          }
        }
      }
    }
    last = now;
  }
  return worst;
}

describe.each(KNIFE_SKINS.map((skin) => [skin]))('the %s in the hand on screen', (skin) => {
  for (const move of ['inspect', 'draw'] as const) {
    it(`moves as a hand could move it through its ${move}, at 60 and 120 frames a second`, () => {
      const at = new Map<number, Worst>();
      for (const hz of [60, 120]) {
        const worst = measure(skin, move, hz);
        at.set(hz, worst);
        for (const [bound, { value, at: when }] of worst.most) {
          expect(value, `${bound} ${when.toFixed(3)} s into its ${move} at ${hz} Hz`).toBeLessThan(
            BOUNDS[bound],
          );
        }
      }
      // No corner: a smooth move's jerk is the same at both rates.
      for (const bound of JERKS) {
        const slow = at.get(60)!.most.get(bound)?.value ?? 0;
        const fast = at.get(120)!.most.get(bound);
        expect(
          fast?.value ?? 0,
          `${bound} ${fast?.at.toFixed(3)} s into its ${move}: ${slow.toFixed(0)} at 60 Hz`,
        ).toBeLessThan(slow * JERK_GROWTH + 10);
      }
    });
  }
});
