import type { Object3D } from 'three';
import { describe, expect, it } from 'vitest';
import {
  INSPECT,
  SWITCH,
  THROW,
  Viewmodel,
  handInspectPose,
  knifeInspectPose,
  switchPose,
  throwPose,
  type ArmPose,
} from './viewmodel.ts';

const blank = (): ArmPose => ({ x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, knife: true, spin: 0 });
const keys = ['x', 'y', 'z', 'rx', 'ry', 'rz'] as const;

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
    for (const [pose, end] of [
      [knifeInspectPose, INSPECT.knife],
      [handInspectPose, INSPECT.hand],
    ] as const) {
      const start = pose(0, blank());
      const done = pose(end, blank());
      for (const k of keys) {
        expect(start[k]).toBeCloseTo(0, 6);
        expect(done[k]).toBeCloseTo(0, 6);
      }
      expect(done.spin).toBe(0);
      for (let t = 0; t <= end; t += 0.05) expect(pose(t, blank()).knife).toBe(true);
    }
  });

  it('turns the knife over to show its other side', () => {
    let most = 0;
    for (let t = 0; t <= INSPECT.knife; t += 0.01) {
      most = Math.max(most, knifeInspectPose(t, blank()).spin);
    }
    expect(most).toBeGreaterThanOrEqual(Math.PI);
  });

  it('moves smoothly, without jumping between its phases', () => {
    expect(largestJump(knifeInspectPose, INSPECT.knife)).toBeLessThan(0.004);
    expect(largestJump(handInspectPose, INSPECT.hand)).toBeLessThan(0.004);
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

  it('inspects whatever is in hand, once at a time, until it is done', () => {
    const vm = ready();
    expect(vm.startInspect()).toBe(true);
    expect(vm.inspecting).toBe(true);
    expect(vm.startInspect()).toBe(false);
    step(vm, INSPECT.knife + 0.05);
    expect(vm.inspecting).toBe(false);
    vm.setArmed(false);
    step(vm, 1);
    expect(vm.startInspect()).toBe(true);
    step(vm, INSPECT.hand + 0.05);
    expect(vm.inspecting).toBe(false);
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
    const holder = (vm as unknown as { knifeHolder: Object3D }).knifeHolder;
    vm.startThrow();
    let previous = holder.quaternion.clone();
    let worst = 0;
    for (let i = 0; i < 6; i++) {
      step(vm, 1 / 60);
      worst = Math.max(worst, holder.quaternion.angleTo(previous));
      previous = holder.quaternion.clone();
    }
    // Spinning most of a turn back in 0.1 s would move well over half a radian a frame.
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
