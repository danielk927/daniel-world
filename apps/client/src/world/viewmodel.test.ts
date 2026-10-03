import { describe, expect, it } from 'vitest';
import { SWITCH, THROW, switchPose, throwPose, type ArmPose } from './viewmodel.ts';

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
