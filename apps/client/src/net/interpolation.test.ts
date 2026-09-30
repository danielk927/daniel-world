import { describe, expect, it } from 'vitest';
import type { PlayerSnapshot } from '@world/shared';
import { ServerClock, SnapshotBuffer, type Pose } from './interpolation.ts';

function snap(x: number, yaw = 0): PlayerSnapshot {
  return { id: 1, x, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw, pitch: 0, grounded: true, ack: 0 };
}

const pose = (): Pose => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, grounded: true });

describe('SnapshotBuffer', () => {
  it('interpolates between the two samples around the render time', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(0, snap(0));
    buffer.push(50, snap(1));
    buffer.push(100, snap(3));
    const out = pose();
    buffer.sample(25, out);
    expect(out.x).toBeCloseTo(0.5);
    buffer.sample(75, out);
    expect(out.x).toBeCloseTo(2);
  });

  it('holds the oldest pose before history and extrapolates only briefly after it', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(100, snap(0));
    buffer.push(150, snap(1));
    const out = pose();
    buffer.sample(0, out);
    expect(out.x).toBe(0);
    buffer.sample(175, out);
    expect(out.x).toBeCloseTo(1.5);
    buffer.sample(10_000, out);
    expect(out.x).toBeCloseTo(4); // capped at 150 ms of extrapolation
  });

  it('turns the short way around when yaw wraps', () => {
    const buffer = new SnapshotBuffer();
    buffer.push(0, snap(0, Math.PI - 0.1));
    buffer.push(50, snap(0, -Math.PI + 0.1));
    const out = pose();
    buffer.sample(25, out);
    expect(Math.abs(Math.abs(out.yaw) - Math.PI)).toBeLessThan(1e-9);
  });

  it('ignores out-of-order samples and keeps working past its capacity', () => {
    const buffer = new SnapshotBuffer();
    for (let i = 0; i < 100; i++) buffer.push(i * 50, snap(i));
    buffer.push(10, snap(-99));
    const out = pose();
    buffer.sample(99 * 50 - 25, out);
    expect(out.x).toBeCloseTo(98.5);
  });
});

describe('ServerClock', () => {
  it('locks onto the fastest delivery and absorbs jitter', () => {
    const clock = new ServerClock();
    clock.observe(1000, 5040); // 40 ms late
    clock.observe(1050, 5070); // 20 ms late: new minimum
    clock.observe(1100, 5190); // 90 ms late: jitter, barely moves the estimate
    // The jittery sample nudges the 20 ms estimate by only 2% of its 70 ms excess.
    expect(clock.serverTime(5070)).toBeCloseTo(1050 - 70 * 0.02, 6);
  });
});
