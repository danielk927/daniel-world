import { PerspectiveCamera, Quaternion, Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { KNIFE_SKINS, knifeLook, type KnifeSkin } from '@world/shared';
import { knifeModel } from './knifeModel.ts';
import { knifeMoves, sample, type ArmPose } from './knifeMoves.ts';
import { ELBOW_RADIUS, SLEEVE_LENGTH } from './sleeve.ts';
import { Viewmodel } from './viewmodel.ts';

/**
 * An inspect shows the knife, as CS2's and Valorant's do, and is never a row of poses held between
 * stops. Through every knife's inspect, seen by the 72 degree, 16:10 eye the game draws it with:
 *
 * - both flats of the blade come near face on, one after the other (the knife lies in the hand with
 *   one flat to the eye, and the other is seen only by turning the whole hand over);
 * - the blade is big enough to read at its biggest, and the blade and the fist stay in view;
 * - nothing is frozen: the knife is never still, hand and blade, for more than a moment, which a
 *   pose held between two stops is (the hold's two keys the same, so the hand stopped dead in it);
 * - the arm never ends in mid-air: the far end of the sleeve, where the elbow would be, is never in
 *   view, in any draw or inspect, at 60 and 120 Hz, at any field of view the player can set (60 to
 *   100, and 107 sprinting) on any screen from 16:10 to 21:9;
 * - I is answered at once, from rest: the knife moves within a tenth of a second of the key, and the
 *   dip before its lift is a dip, not a tenth of one swallowed by blending in out of the idle.
 *
 * The first inspects of the grounded rework held 35 to 50 percent of their length frozen, in holds
 * up to 2.3 s, showed one flat of five knives not at all and were small and to the right of the view.
 */

/** The nearest a flat comes to face on, as the cosine of its angle to the eye (41 degrees at most). */
const FLAT_SEEN = 0.75;
/** The blade, tip to grip, at its biggest: pixels on a 900 px high screen for each meter of it. */
const BLADE_SEEN = 1500;
/** The most a hand and a blade may hold still for, in seconds, and what still is. */
const FROZEN = { for: 0.2, tip: 0.012, turn: 0.04 } as const;
const FRAME = 1 / 60;

const eye = new PerspectiveCamera(72, 1440 / 900, 0.05, 200);
eye.updateMatrixWorld(true);
/** The views a player can have: the field of view (vertical, degrees) and the screen's shape. */
const VIEWS = [60, 72, 100, 107].flatMap((fov) =>
  [1.6, 16 / 9, 21 / 9].map((aspect) => {
    const camera = new PerspectiveCamera(fov, aspect, 0.05, 200);
    camera.updateMatrixWorld(true);
    return camera;
  }),
);
const still = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };

interface Parts {
  model: Object3D;
  hand: { wrist: Object3D };
  scene: Object3D;
}

/** What the eye sees of a knife through its inspect. */
function seen(skin: KnifeSkin) {
  const vm = new Viewmodel();
  vm.setLook(knifeLook(skin, undefined));
  vm.setShown(true);
  const moves = knifeMoves(skin);
  for (let t = 0; t < moves.draw.duration + 1.5; t += FRAME) {
    vm.update(FRAME, still as never, 0, 0, 0, true);
  }
  vm.startInspect();
  const parts = vm as unknown as Parts;
  const model = knifeModel(skin);
  const [cz, cy] = model.center;
  const [gz, gy] = model.grip;
  let plus = 0;
  let minus = 0;
  let blade = 0; // px
  let inView = true;
  let frozenFor = 0;
  let longestFrozen = { seconds: 0, at: 0 };
  let lastTip: Vector3 | null = null;
  let lastWrist: Quaternion | null = null;
  const duration = moves.inspect.duration;
  for (let frame = 1; frame * FRAME < duration; frame++) {
    vm.update(FRAME, still as never, 0, 0, 0, true);
    parts.scene.updateMatrixWorld(true);
    const t = frame * FRAME;
    const tip = parts.model.localToWorld(new Vector3(0, 0, 0));
    const grip = parts.model.localToWorld(new Vector3(0, gy, gz));
    const centre = parts.model.localToWorld(new Vector3(0, cy, cz));
    const flat = new Vector3(1, 0, 0).applyQuaternion(
      parts.model.getWorldQuaternion(new Quaternion()),
    );
    const face = flat.dot(centre.clone().negate().normalize());
    plus = Math.max(plus, face);
    minus = Math.max(minus, -face);
    const nTip = tip.clone().project(eye);
    const nGrip = grip.clone().project(eye);
    blade = Math.max(blade, Math.hypot((nTip.x - nGrip.x) * 720, (nTip.y - nGrip.y) * 450));
    for (const n of [nTip, nGrip]) {
      if (Math.abs(n.x) > 0.97 || Math.abs(n.y) > 0.97) inView = false;
    }
    const wrist = parts.hand.wrist.getWorldQuaternion(new Quaternion());
    if (lastTip && lastWrist) {
      const tipSpeed = tip.distanceTo(lastTip) / FRAME;
      const turn = (2 * Math.acos(Math.min(1, Math.abs(wrist.dot(lastWrist))))) / FRAME;
      // Held still at either end of the inspect is the knife at rest, and is not counted.
      const resting = t < 0.2 || t > duration - 0.2;
      if (!resting && tipSpeed < FROZEN.tip && turn < FROZEN.turn) frozenFor += FRAME;
      else frozenFor = 0;
      if (frozenFor > longestFrozen.seconds) longestFrozen = { seconds: frozenFor, at: t };
    }
    lastTip = tip;
    lastWrist = wrist;
  }
  return { plus, minus, blade: blade / gz, inView, longestFrozen };
}

/**
 * Where and when the sleeve's elbow end (its rim, at the far end of the sleeve) is in any of the
 * views in a draw or an inspect at `hz`, or null if it never is.
 */
function elbowShown(skin: KnifeSkin, move: 'draw' | 'inspect', hz: number): string | null {
  const dt = 1 / hz;
  const vm = new Viewmodel();
  vm.setLook(knifeLook(skin, undefined));
  vm.setShown(true);
  const moves = knifeMoves(skin);
  const parts = vm as unknown as { sleeve: Object3D; scene: Object3D };
  let seconds = moves.draw.duration + 0.4;
  if (move === 'inspect') {
    for (let t = 0; t < moves.draw.duration + 1.5; t += dt) {
      vm.update(dt, still as never, 0, 0, 0, true);
    }
    vm.startInspect();
    seconds = moves.inspect.duration + 0.3;
  }
  const rim = new Vector3();
  for (let frame = 1; frame * dt < seconds; frame++) {
    vm.update(dt, still as never, 0, 0, 0, true);
    parts.scene.updateMatrixWorld(true);
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      rim.set(Math.cos(a) * ELBOW_RADIUS, Math.sin(a) * ELBOW_RADIUS, SLEEVE_LENGTH / 2);
      const world = parts.sleeve.localToWorld(rim);
      for (const view of VIEWS) {
        const at = world.clone().project(view);
        if (at.z < 1 && Math.abs(at.x) < 1 && Math.abs(at.y) < 1) {
          return `${(frame * dt).toFixed(2)} s, at ${view.fov} degrees on ${view.aspect.toFixed(2)}:1`;
        }
      }
    }
  }
  return null;
}

/** A knife up in the hand, its draw done and its idle under way, then I pressed. */
function pressedFromIdle(skin: KnifeSkin): Viewmodel {
  const vm = new Viewmodel();
  vm.setLook(knifeLook(skin, undefined));
  vm.setShown(true);
  for (let t = 0; t < knifeMoves(skin).draw.duration + 1.5; t += FRAME) {
    vm.update(FRAME, still as never, 0, 0, 0, true);
  }
  vm.startInspect();
  return vm;
}

describe.each(KNIFE_SKINS.map((skin) => [skin]))('the %s inspect', (skin) => {
  const shown = seen(skin);

  it('shows both flats of its blade, near face on', () => {
    expect(shown.plus, 'the flat on the far side').toBeGreaterThan(FLAT_SEEN);
    expect(shown.minus, 'the flat it rests showing').toBeGreaterThan(FLAT_SEEN);
  });

  it('is big enough to read, with the blade and the fist in view', () => {
    expect(shown.blade).toBeGreaterThan(BLADE_SEEN);
    expect(shown.inView).toBe(true);
  });

  it('never shows the end of its sleeve, in its draw or its inspect, in any view', () => {
    for (const move of ['draw', 'inspect'] as const) {
      for (const hz of [60, 120]) {
        const at = elbowShown(skin, move, hz);
        expect(at, `the elbow end shows ${at} into its ${move} at ${hz} Hz`).toBeNull();
      }
    }
  });

  it('answers I from rest within a tenth of a second', () => {
    const vm = pressedFromIdle(skin);
    const parts = vm as unknown as { model: Object3D; scene: Object3D };
    const tip = (): Vector3 => {
      parts.scene.updateMatrixWorld(true);
      return parts.model.localToWorld(new Vector3(0, 0, 0)).project(eye);
    };
    const start = tip();
    let answered = Infinity;
    for (let frame = 1; frame * FRAME <= 0.4; frame++) {
      vm.update(FRAME, still as never, 0, 0, 0, true);
      const at = tip();
      if (Math.hypot((at.x - start.x) * 720, (at.y - start.y) * 450) > 5) {
        answered = frame * FRAME;
        break;
      }
    }
    expect(answered, 'seconds until the tip has moved 5 px').toBeLessThan(0.11);
  });

  it('lets the dip before its lift show, from rest', () => {
    const vm = pressedFromIdle(skin);
    const pose = (vm as unknown as { pose: ArmPose }).pose;
    const clip = knifeMoves(skin).inspect;
    const out = {} as ArmPose;
    let deepest = 0;
    let own = 0;
    for (let frame = 1; frame * FRAME <= 0.5; frame++) {
      vm.update(FRAME, still as never, 0, 0, 0, true);
      deepest = Math.min(deepest, pose.y);
      own = Math.min(own, sample(clip, frame * FRAME, out).y);
    }
    expect(own, 'the clip dips').toBeLessThan(-0.005);
    const said = `dips ${(deepest * 1000).toFixed(1)} mm of the clip's ${(own * 1000).toFixed(1)} mm`;
    expect(deepest / own, said).toBeGreaterThan(0.75);
  });

  it('is never frozen in a pose held between two stops', () => {
    const { seconds, at } = shown.longestFrozen;
    expect(seconds, `frozen ${seconds.toFixed(2)} s at ${at.toFixed(2)} s`).toBeLessThan(
      FROZEN.for,
    );
  });
});
