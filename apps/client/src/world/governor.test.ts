import { describe, expect, it } from 'vitest';
import { QualityGovernor, RENDER_LEVELS, snapRefreshInterval } from './governor.ts';

const run = (governor: QualityGovernor, ms: number, frames: number): number[] => {
  const changes: number[] = [];
  for (let i = 0; i < frames; i++) {
    const next = governor.frame(ms);
    if (next !== null) changes.push(next);
  }
  return changes;
};

describe('the render quality governor', () => {
  it('leaves quality alone while frames keep up with the display', () => {
    const governor = new QualityGovernor(1000 / 120, 0);
    expect(run(governor, 1000 / 120, 2000)).toEqual([]);
    expect(governor.level).toBe(0);
  });

  it('steps down while the GPU falls behind the display, one level at a time', () => {
    // A 120 Hz display getting 70 fps: queued frames, so input lag.
    const governor = new QualityGovernor(1000 / 120, 0);
    const changes = run(governor, 1000 / 70, 300);
    expect(changes.length).toBeGreaterThan(1);
    changes.forEach((level, i) => expect(level).toBe(i + 1));
    // Once fast enough, it stays put.
    expect(run(governor, 1000 / 120, 600)).toEqual([]);
  });

  it('never goes below the cheapest level', () => {
    const governor = new QualityGovernor(1000 / 60, 0);
    run(governor, 50, 3000);
    expect(governor.level).toBe(RENDER_LEVELS.length - 1);
  });

  it('ignores single hitches and paused tabs', () => {
    const governor = new QualityGovernor(1000 / 60, 0);
    for (let i = 0; i < 600; i++) {
      governor.frame(i % 50 === 0 ? 120 : 1000 / 60);
      governor.frame(i === 300 ? 5000 : 1000 / 60);
    }
    expect(governor.level).toBe(0);
  });

  it('after a long run of easy frames, tries one level up, and steps back if it cannot hold it', () => {
    const governor = new QualityGovernor(1000 / 60, 3);
    const up = run(governor, 1000 / 60, 60 * 30);
    expect(up).toEqual([2]);
    // Level 2 is too much for this GPU: back down at once, and no more tries this session.
    expect(run(governor, 1000 / 45, 60)).toEqual([3]);
    expect(run(governor, 1000 / 60, 60 * 120)).toEqual([]);
  });
});

describe('the display refresh probe', () => {
  it('snaps the shortest frame interval to a standard refresh rate', () => {
    expect(snapRefreshInterval(16.4)).toBeCloseTo(1000 / 60, 5);
    expect(snapRefreshInterval(8.2)).toBeCloseTo(1000 / 120, 5);
    expect(snapRefreshInterval(6.8)).toBeCloseTo(1000 / 144, 5);
    expect(snapRefreshInterval(13.4)).toBeCloseTo(1000 / 75, 5);
    // Nonsense (a throttled or hidden tab) falls back to 60 Hz.
    expect(snapRefreshInterval(Infinity)).toBeCloseTo(1000 / 60, 5);
  });
});
