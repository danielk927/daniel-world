import { Vector3, type Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import { KNIFE_SKINS, SKIN_FINISHES, type KnifeSkin } from '@world/shared';
import { knifeCenter } from './knifeModel.ts';
import { knifeMoves } from './knifeMoves.ts';
import {
  INSPECT,
  PUNCH,
  SWITCH,
  THROW,
  Viewmodel,
  knifeInspectPose,
  punchPose,
  switchPose,
  throwPose,
  type ArmPose,
} from './viewmodel.ts';

const blank = (): ArmPose => ({
  x: 0,
  y: 0,
  z: 0,
  rx: 0,
  ry: 0,
  rz: 0,
  knife: true,
  spin: 0,
  flip: 0,
  a: 0,
  b: 0,
  hang: 0,
});
const keys = ['x', 'y', 'z', 'rx', 'ry', 'rz'] as const;
/** How far an angle is from a whole number of turns: a whole turn looks the same as none. */
const offTurn = (angle: number): number =>
  Math.abs(angle - Math.PI * 2 * Math.round(angle / (Math.PI * 2)));

function largestJump(pose: (t: number, out: ArmPose) => ArmPose, end: number): number {
  let worst = 0;
  const step = 1 / 6000;
  for (let t = 0; t < end; t += step) {
    const a = pose(t, blank());
    const b = pose(t + step, blank());
    for (const k of keys) worst = Math.max(worst, Math.abs(b[k] - a[k]));
  }
  return worst;
}

describe('the throw animation', () => {
  it('holds the knife until it lets go, then draws a fresh one', () => {
    expect(throwPose(THROW.release - 0.001, blank()).knife).toBe(true);
    expect(throwPose(THROW.release + 0.001, blank()).knife).toBe(false);
    expect(throwPose(THROW.drawFrom - 0.001, blank()).knife).toBe(false);
    expect(throwPose(THROW.drawFrom + 0.001, blank()).knife).toBe(true);
  });

  it('starts and ends at rest, with no spin left over', () => {
    const start = throwPose(0, blank());
    const end = throwPose(THROW.drawTo, blank());
    for (const k of keys) {
      expect(start[k]).toBeCloseTo(0, 6);
      expect(end[k]).toBeCloseTo(0, 6);
    }
    expect(end.spin).toBe(0);
  });

  it('moves smoothly, without jumping between its phases', () => {
    // Sampled finely, even the snap (about 23 rad/s) moves little per step; a teleport would not.
    expect(largestJump(throwPose, THROW.drawTo)).toBeLessThan(0.012);
    expect(largestJump(switchPose, SWITCH.raise)).toBeLessThan(0.004);
  });

  it('switches by lowering out of view and raising back to rest', () => {
    expect(switchPose(SWITCH.lower, blank()).y).toBeLessThan(-0.3);
    expect(switchPose(SWITCH.raise, blank()).y).toBeCloseTo(0, 6);
  });
});

describe('the inspect animation', () => {
  it('starts and ends at rest, with the knife in hand and no spin left over', () => {
    const start = knifeInspectPose(0, blank());
    const done = knifeInspectPose(INSPECT, blank());
    for (const k of keys) {
      expect(start[k]).toBeCloseTo(0, 6);
      expect(done[k]).toBeCloseTo(0, 6);
    }
    expect(done.spin).toBe(0);
    for (let t = 0; t <= INSPECT; t += 0.05) expect(knifeInspectPose(t, blank()).knife).toBe(true);
  });

  it('turns the knife over to show its other side', () => {
    let most = 0;
    for (let t = 0; t <= INSPECT; t += 0.01) {
      most = Math.max(most, knifeInspectPose(t, blank()).spin);
    }
    expect(most).toBeGreaterThanOrEqual(Math.PI);
  });

  it('moves smoothly, without jumping between its phases', () => {
    expect(largestJump(knifeInspectPose, INSPECT)).toBeLessThan(0.004);
  });
});

describe('the punch animation', () => {
  it('jabs out toward the middle of the view and comes back to rest', () => {
    const start = punchPose(0, blank());
    const done = punchPose(PUNCH.recover, blank());
    for (const k of keys) {
      expect(start[k]).toBeCloseTo(0, 6);
      expect(done[k]).toBeCloseTo(0, 6);
    }
    const hit = punchPose(PUNCH.hit, blank());
    expect(hit.z).toBeLessThan(-0.08);
    expect(hit.x).toBeLessThan(-0.05);
  });

  it('moves smoothly, fast as a jab is', () => {
    expect(largestJump(punchPose, PUNCH.recover)).toBeLessThan(0.006);
  });
});

describe('the view model', () => {
  const camera = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };
  const step = (vm: Viewmodel, seconds: number): void => {
    for (let t = 0; t < seconds; t += 1 / 60) {
      vm.update(1 / 60, camera as never, 0, 0, 0, true);
    }
  };
  const ready = (): Viewmodel => {
    const vm = new Viewmodel();
    vm.setShown(true);
    step(vm, 1);
    return vm;
  };

  it('inspects the knife until it is done, and never the bare hand', () => {
    const vm = ready();
    expect(vm.inspectTime).toBeNull();
    expect(vm.startInspect()).toBe(true);
    expect(vm.inspecting).toBe(true);
    expect(vm.inspectTime).toBe(0);
    step(vm, INSPECT + 0.05);
    expect(vm.inspecting).toBe(false);
    expect(vm.inspectTime).toBeNull();
    vm.setArmed(false);
    step(vm, 1);
    expect(vm.startInspect()).toBe(false);
    expect(vm.inspecting).toBe(false);
  });

  it('starts the inspect over on every press, as CS2 does', () => {
    const vm = ready();
    vm.startInspect();
    step(vm, 1);
    expect(vm.inspectTime).toBeGreaterThan(0.95);
    expect(vm.startInspect()).toBe(true);
    expect(vm.inspectTime).toBe(0);
    // Well past where the first would have ended, the second is still playing...
    step(vm, INSPECT - 0.2);
    expect(vm.inspecting).toBe(true);
    // ...and ends a whole inspect after its own press.
    step(vm, 0.3);
    expect(vm.inspecting).toBe(false);
    // Pressed over and over, it keeps starting over.
    vm.startInspect();
    for (let i = 0; i < 40; i++) {
      step(vm, 0.05);
      expect(vm.startInspect()).toBe(true);
    }
    expect(vm.inspectTime).toBe(0);
  });

  it('will not inspect out of view, with the bare hand, mid-throw or mid-switch', () => {
    const vm = ready();
    vm.setShown(false);
    expect(vm.startInspect()).toBe(false);
    vm.setShown(true);
    step(vm, 1);
    vm.startInspect();
    step(vm, 0.5);
    // A throw cuts an inspect short, and another press does not bring it back mid-throw.
    expect(vm.startThrow()).toBe(true);
    for (let t = 0; t < THROW.drawTo - 0.05; t += 0.05) {
      expect(vm.startInspect()).toBe(false);
      step(vm, 0.05);
    }
    step(vm, 0.1);
    expect(vm.startInspect()).toBe(true);
    // Putting the knife away cuts it short too, and a press on the way down or with the bare hand
    // up does nothing.
    vm.setArmed(false);
    expect(vm.inspecting).toBe(false);
    expect(vm.startInspect()).toBe(false);
    step(vm, 1);
    expect(vm.startInspect()).toBe(false);
    // Drawing it again: not while the bare hand is still going down, but as soon as the knife is
    // in the hand.
    vm.setArmed(true);
    step(vm, SWITCH.lower - 0.05);
    expect(vm.startInspect()).toBe(false);
    step(vm, 0.1);
    expect(vm.startInspect()).toBe(true);
  });

  it('inspects out of the draw the moment the knife is in hand, but throws only once it is up', () => {
    const vm = new Viewmodel();
    // The butterfly's draw flips it open well after it is up.
    vm.setLook({ skin: 'butterfly', finish: SKIN_FINISHES.butterfly[0]! });
    vm.setShown(true);
    // Back in view, the knife is coming up from below the screen: I cuts that short.
    step(vm, 0.05);
    expect(vm.canThrow).toBe(false);
    expect(vm.startInspect()).toBe(true);
    expect(vm.inspectTime).toBe(0);
    // It can be thrown no sooner for that.
    step(vm, SWITCH.raise - SWITCH.lower - 0.12);
    expect(vm.canThrow).toBe(false);
    step(vm, 0.1);
    expect(vm.canThrow).toBe(true);
    expect(vm.inspecting).toBe(true);
    // Up, with its flourish still to play, it inspects just the same.
    const up = new Viewmodel();
    up.setLook({ skin: 'butterfly', finish: SKIN_FINISHES.butterfly[0]! });
    up.setShown(true);
    step(up, SWITCH.raise - SWITCH.lower + 0.05);
    expect(up.startInspect()).toBe(true);
    step(up, 1);
    expect(up.inspecting).toBe(true);
  });

  it('punches with the bare hand, one jab at a time', () => {
    const vm = ready();
    expect(vm.startPunch()).toBe(false);
    vm.setArmed(false);
    step(vm, 1);
    expect(vm.startPunch()).toBe(true);
    step(vm, 1 / 60);
    expect(vm.punching).toBe(true);
    expect(vm.startPunch()).toBe(false);
    step(vm, PUNCH.recover);
    expect(vm.punching).toBe(false);
    expect(vm.startPunch()).toBe(true);
  });

  it('curls the hand into a fist to punch and opens it again gradually, never in one frame', () => {
    const vm = ready();
    const parts = vm as unknown as { fist: Object3D; open: Object3D };
    vm.setArmed(false);
    step(vm, 1);
    expect(vm.handCurl).toBe(0);
    vm.startPunch();
    let worst = 0;
    let most = 0;
    let previous = vm.handCurl;
    for (let i = 0; i < 60; i++) {
      step(vm, 1 / 60);
      // The same hand all along: the knife's fist never stands in for it.
      expect(parts.open.visible).toBe(true);
      expect(parts.fist.visible).toBe(false);
      most = Math.max(most, vm.handCurl);
      if (i > 6) worst = Math.max(worst, Math.abs(vm.handCurl - previous));
      previous = vm.handCurl;
    }
    expect(most).toBeGreaterThan(0.9);
    // Opening takes several frames.
    expect(worst).toBeLessThan(0.2);
    expect(vm.handCurl).toBeLessThan(0.05);
  });

  it('stops a punch to switch to the knife', () => {
    const vm = ready();
    vm.setArmed(false);
    step(vm, 1);
    vm.startPunch();
    vm.setArmed(true);
    expect(vm.punching).toBe(false);
  });

  it('stops inspecting to throw or switch, and not mid-throw', () => {
    const vm = ready();
    vm.startInspect();
    expect(vm.startThrow()).toBe(true);
    expect(vm.inspecting).toBe(false);
    expect(vm.startInspect()).toBe(false);
    step(vm, THROW.drawTo);
    vm.startInspect();
    vm.setArmed(false);
    expect(vm.inspecting).toBe(false);
  });

  it('cuts a late inspect short into a throw without spinning the knife back', () => {
    const vm = ready();
    vm.startInspect();
    step(vm, 2.3);
    // The knife turns about its length in the spinner.
    const spinner = (vm as unknown as { spinner: Object3D }).spinner;
    const spin = (): number => -spinner.rotation.z;
    vm.startThrow();
    let previous = spin();
    let worst = 0;
    for (let i = 0; i < 6; i++) {
      step(vm, 1 / 60);
      worst = Math.max(worst, offTurn(spin() - previous));
      previous = spin();
    }
    // Most of a turn is done: the rest is the short way home. Spinning back the long way, most of a
    // turn in 0.1 s, would move over half a radian a frame.
    expect(worst).toBeLessThan(0.35);
  });

  it('reports how far the next knife is from ready', () => {
    const vm = ready();
    expect(vm.knifeReadiness).toBe(1);
    vm.startThrow();
    step(vm, THROW.release + 0.02);
    expect(vm.knifeReadiness).toBeLessThan(0.1);
    step(vm, THROW.drawTo);
    expect(vm.knifeReadiness).toBe(1);
  });
});

const FRAME = 1 / 60;
const still = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };

/** The knife drawn and up, its draw done, at rest with nothing going on. */
function knifeUp(skin: KnifeSkin): Viewmodel {
  const vm = new Viewmodel();
  vm.setLook({ skin, finish: SKIN_FINISHES[skin][0]! });
  vm.setShown(true);
  for (let i = 0; i < 60; i++) vm.update(FRAME, still as never, 0, 0, 0, true);
  return vm;
}

/**
 * Plays the arm a frame at a time, following three points of the knife in the hand on screen: its
 * tip, its middle, and a point beside its length, which a spin about the length moves. `speed` is
 * the most any moves in a frame, `jolt` the most the way any moves changes from one frame to the
 * next: what the eye sees as the knife jumping.
 */
class KnifeMotion {
  speed = 0;
  jolt = 0;
  private readonly vm: Viewmodel;
  private readonly model: Object3D;
  private readonly points: Vector3[];
  private last: Vector3[] = [];
  private readonly lastStep: Vector3[] = [];

  constructor(vm: Viewmodel, skin: KnifeSkin) {
    this.vm = vm;
    this.model = (vm as unknown as { model: Object3D }).model;
    const [z, y] = knifeCenter(skin);
    this.points = [new Vector3(), new Vector3(0, y, z), new Vector3(0.03, y, z)];
  }

  play(seconds: number): void {
    for (let t = 0; t < seconds - 1e-9; t += FRAME) this.frame();
  }

  frame(): void {
    this.vm.update(FRAME, still as never, 0, 0, 0, true);
    this.vm.knifeCenter(new Vector3());
    const now = this.points.map((p) => this.model.localToWorld(p.clone()));
    now.forEach((p, i) => {
      const last = this.last[i];
      if (!last) return;
      const step = p.clone().sub(last);
      this.speed = Math.max(this.speed, step.length());
      const before = this.lastStep[i];
      if (before) this.jolt = Math.max(this.jolt, step.distanceTo(before));
      this.lastStep[i] = step;
    });
    this.last = now;
  }

  /** Measure from here on. */
  reset(): void {
    this.speed = 0;
    this.jolt = 0;
  }
}

describe.each(KNIFE_SKINS.map((skin) => [skin]))('pressing I over and over with the %s', (skin) => {
  const inspect = knifeMoves(skin).inspect.duration;
  /** The knife's own inspect, played through: how fast it moves the knife, and how hard it jolts. */
  const own = ((): KnifeMotion => {
    const vm = knifeUp(skin);
    const motion = new KnifeMotion(vm, skin);
    motion.frame();
    vm.startInspect();
    motion.play(inspect + 0.2);
    return motion;
  })();

  it('starts the inspect over without jolting the knife, wherever it is cut', () => {
    for (let cut = 0.05; cut < inspect; cut += 0.05) {
      const vm = knifeUp(skin);
      const motion = new KnifeMotion(vm, skin);
      vm.startInspect();
      motion.play(cut);
      motion.reset();
      expect(vm.startInspect()).toBe(true);
      motion.play(0.5);
      // Cutting back to the start can take a knife half a turn round quickly, but never jumps.
      expect(motion.speed, `cut at ${cut.toFixed(2)} s`).toBeLessThan(own.speed * 2);
      expect(motion.jolt, `cut at ${cut.toFixed(2)} s`).toBeLessThan(own.jolt * 2);
    }
  });

  it('stays smooth however fast I is pressed', () => {
    for (const from of [0.3, 0.8, 1.3, 1.8, 2.3]) {
      for (const frames of [1, 2, 3, 6]) {
        const vm = knifeUp(skin);
        const motion = new KnifeMotion(vm, skin);
        vm.startInspect();
        motion.play(from);
        motion.reset();
        for (let i = 0; i < 90; i++) {
          if (i % frames === 0) expect(vm.startInspect()).toBe(true);
          motion.frame();
        }
        const pressed = `from ${from} s, every ${frames} frames`;
        expect(motion.speed, pressed).toBeLessThan(own.speed * 1.5);
        expect(motion.jolt, pressed).toBeLessThan(own.jolt * 1.5);
      }
    }
  });

  it('inspects out of its draw, wherever it is cut, about as smoothly as it draws', () => {
    const drawing = (): Viewmodel => {
      const vm = new Viewmodel();
      vm.setLook({ skin, finish: SKIN_FINISHES[skin][0]! });
      return vm;
    };
    /** The draw itself, from coming into view to rest. */
    const draw = drawing();
    const drawn = new KnifeMotion(draw, skin);
    draw.setShown(true);
    drawn.play(1.2);
    const frames = Math.ceil(knifeMoves(skin).draw.duration / FRAME);
    for (let k = 1; k < frames; k++) {
      const vm = drawing();
      const motion = new KnifeMotion(vm, skin);
      vm.setShown(true);
      for (let i = 0; i < k; i++) motion.frame();
      motion.reset();
      expect(vm.startInspect(), `${k} frames in`).toBe(true);
      motion.play(0.5);
      expect(motion.speed, `${k} frames in`).toBeLessThan(drawn.speed * 1.5);
      expect(motion.jolt, `${k} frames in`).toBeLessThan(drawn.jolt * 1.5);
    }
  });
});

describe('starting an inspect over', () => {
  it('takes the knife the shorter way to where the inspect is headed, not a whole turn round', () => {
    // Late in its inspect the karambit has spun to hang claw up over the ring: half a turn, where
    // the inspect's opening swings it again. Starting over swings it back toward the start as the
    // opening brings it up again, a little over half a turn in all, rather than spinning it a whole
    // turn round to get there.
    const vm = knifeUp('karambit');
    vm.startInspect();
    for (let t = 0; t < 2.3; t += FRAME) vm.update(FRAME, still as never, 0, 0, 0, true);
    const flipper = (vm as unknown as { flipper: Object3D }).flipper;
    let previous = flipper.rotation.x;
    let turned = 0;
    expect(vm.startInspect()).toBe(true);
    for (let i = 0; i < 30; i++) {
      vm.update(FRAME, still as never, 0, 0, 0, true);
      turned += offTurn(flipper.rotation.x - previous);
      previous = flipper.rotation.x;
    }
    expect(turned).toBeLessThan(Math.PI * 1.5);
  });
});
