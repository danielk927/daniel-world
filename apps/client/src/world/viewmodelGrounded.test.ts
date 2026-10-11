import { Matrix4, Quaternion, Vector3, type Bone, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { KNIFE_SKINS, knifeLook, type KnifeSkin } from '@world/shared';
import { knifeModel } from './knifeModel.ts';
import { knifeMoves, sample, type ArmPose } from './knifeMoves.ts';
import { Viewmodel } from './viewmodel.ts';

/**
 * Every motion of the knife in the hand on screen is one a real hand and wrist can make while holding
 * a real knife: through every knife's draw and inspect, at 60 and at 120 frames a second, the knife
 * stays where the fingers hold it, in the hand's own frame, and turns in the hand no more than a
 * grip lets it. It is carried by the arm and the wrist, which turn the hand and the knife in it
 * together; it is never tossed, nor spun on or about a finger, nor turned in the fist.
 *
 * The knives with moving parts (the flip knife and the stiletto's blade, the butterfly's blade and
 * free handle) are the exception that proves it: the knife is followed by what is fixed in the
 * hand, and a hinge turns about its own pin, between its stops. Before this, a knife left the hand
 * for the index finger and was spun round it, or turned over in the fist, in the inspects and some
 * draws of 11 of the 12 knives.
 */

/** How far the knife's grip may stray from where the fingers hold it, in meters as seen. */
const GRIP_STRAY = 0.003;
/** How far the knife may turn in the hand, in radians: about what fingers take up in a grip. */
const GRIP_TURN = 0.1;
/**
 * How far a wrist and a forearm turn, in radians, in the pose channels (`ArmPose`): the wrist
 * flexes 70 degrees toward the palm and extends 60 the other way, and swings 30 toward the thumb
 * and 20 toward the little finger, plus the arm's own play; the forearm rolls under 90 degrees
 * either way from neutral.
 */
const WRIST = { flex: [-1.2, 1.3], dev: [-0.5, 0.45] } as const;
const FOREARM_ROLL = 1.5;
/** A hinge turns between its stops, which are a half turn apart. */
const HINGE_STOP = Math.PI + 0.01;

const camera = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };

interface Parts {
  model: Object3D;
  arm: Object3D;
  knifeHolder: Object3D;
  hand: { wrist: Bone };
  scene: Object3D;
}

/** Where the knife is in the hand, in the hand's own frame: its grip, and how it is turned. */
interface InHand {
  grip: Vector3;
  turn: Quaternion;
}

function inHand(vm: Viewmodel, skin: KnifeSkin): InHand {
  const parts = vm as unknown as Parts;
  parts.scene.updateMatrixWorld(true);
  const [gz, gy] = knifeModel(skin).grip;
  const wrist = parts.hand.wrist;
  const scale = parts.arm.getWorldScale(new Vector3()).x;
  const toHand = new Matrix4().copy(wrist.matrixWorld).invert();
  const wristTurn = wrist.getWorldQuaternion(new Quaternion());
  return {
    grip: parts.model
      .localToWorld(new Vector3(0, gy, gz))
      .applyMatrix4(toHand)
      .multiplyScalar(scale),
    turn: wristTurn.invert().multiply(parts.model.getWorldQuaternion(new Quaternion())),
  };
}

/** The knife held at rest in the hand, once it is drawn and the fingers have closed on it. */
function atRest(skin: KnifeSkin): InHand {
  const vm = new Viewmodel();
  vm.setLook(knifeLook(skin, undefined));
  vm.setShown(true);
  for (let t = 0; t < knifeMoves(skin).draw.duration + 1.5; t += 1 / 60) {
    vm.update(1 / 60, camera as never, 0, 0, 0, true);
  }
  return inHand(vm, skin);
}

/** The most the knife strays from the grip, and turns from how it is held, through a move. */
function worst(skin: KnifeSkin, move: 'draw' | 'inspect', hz: number) {
  const dt = 1 / hz;
  const held = atRest(skin);
  const vm = new Viewmodel();
  vm.setLook(knifeLook(skin, undefined));
  vm.setShown(true);
  const moves = knifeMoves(skin);
  if (move === 'inspect') {
    for (let t = 0; t < moves.draw.duration + 1.5; t += dt) {
      vm.update(dt, camera as never, 0, 0, 0, true);
    }
    vm.startInspect();
  }
  const seconds = (move === 'draw' ? moves.draw : moves.inspect).duration + 0.4;
  const parts = vm as unknown as Parts;
  let stray = { value: 0, at: 0 };
  let turned = { value: 0, at: 0 };
  for (let frame = 1; frame * dt <= seconds + 1e-9; frame++) {
    vm.update(dt, camera as never, 0, 0, 0, true);
    if (!parts.knifeHolder.visible) continue;
    const now = inHand(vm, skin);
    const away = now.grip.distanceTo(held.grip);
    const angle = now.turn.angleTo(held.turn);
    if (away > stray.value) stray = { value: away, at: frame * dt };
    if (angle > turned.value) turned = { value: angle, at: frame * dt };
  }
  return { stray, turned };
}

describe.each(KNIFE_SKINS.map((skin) => [skin]))('the %s in the hand on screen', (skin) => {
  for (const move of ['inspect', 'draw'] as const) {
    it(`stays in the hand, held as its grip holds it, through its ${move}, at 60 and 120 frames a second`, () => {
      for (const hz of [60, 120]) {
        const { stray, turned } = worst(skin, move, hz);
        const where = `into its ${move} at ${hz} Hz`;
        expect(stray.value, `grip strays ${stray.at.toFixed(3)} s ${where}`).toBeLessThan(
          GRIP_STRAY,
        );
        expect(turned.value, `knife turns ${turned.at.toFixed(3)} s ${where}`).toBeLessThan(
          GRIP_TURN,
        );
      }
    });
  }

  it('is carried by a wrist and a forearm that turn no further than they do', () => {
    const moves = knifeMoves(skin);
    for (const clip of [moves.draw, moves.redraw, moves.inspect, moves.idle]) {
      for (let t = 0; t <= clip.duration; t += 0.005) {
        const p = sample(clip, t, {} as ArmPose);
        const at = `${t.toFixed(3)} s`;
        expect(p.flex, `flexing at ${at}`).toBeGreaterThan(WRIST.flex[0]);
        expect(p.flex, `flexing at ${at}`).toBeLessThan(WRIST.flex[1]);
        expect(p.dev, `swinging at ${at}`).toBeGreaterThan(WRIST.dev[0]);
        expect(p.dev, `swinging at ${at}`).toBeLessThan(WRIST.dev[1]);
        expect(Math.abs(p.rz), `forearm rolling at ${at}`).toBeLessThan(FOREARM_ROLL);
      }
    }
  });

  it('opens and closes only what the knife has to open and close, between its stops', () => {
    const channels = new Set(
      knifeModel(skin).parts.flatMap((p) => (p.joint ? [p.joint.channel] : [])),
    );
    const moves = knifeMoves(skin);
    for (const clip of [moves.draw, moves.redraw, moves.inspect, moves.idle]) {
      for (let t = 0; t <= clip.duration; t += 0.005) {
        const p = sample(clip, t, {} as ArmPose);
        for (const hinge of ['a', 'b'] as const) {
          const angle = p[hinge];
          if (!channels.has(hinge)) expect(angle, `${hinge} of a knife without it`).toBe(0);
          expect(Math.abs(angle)).toBeLessThan(HINGE_STOP);
        }
        // The fingers loosen only where a blade or a handle swings through them.
        if (channels.size === 0) expect(p.loose, 'a knife with nothing to swing').toBe(0);
      }
    }
  });
});
