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

  it('keeps full quality when the browser caps the frame rate below the display', () => {
    // Chrome's Energy Saver holds pages to 30 fps; dropping quality would not buy a frame.
    const governor = new QualityGovernor(snapRefreshInterval(33.4), 0);
    expect(run(governor, 1000 / 30, 3000)).toEqual([]);
  });

  it('judges against a faster refresh once frames show one, as when the cap lifts', () => {
    // Loaded under a 30 fps cap, then plugged in: a 120 Hz display, the GPU managing 70 fps.
    const governor = new QualityGovernor(1000 / 30, 0);
    expect(run(governor, 1000 / 30, 300)).toEqual([]);
    const changes: number[] = [];
    for (let i = 0; i < 600; i++) {
      const next = governor.frame(i % 7 < 2 ? 1000 / 120 : 1000 / 60);
      if (next !== null) changes.push(next);
    }
    expect(changes[0]).toBe(1);
    // Keeping up with 120 Hz at the new level, it stays put.
    expect(run(governor, 1000 / 120, 600)).toEqual([]);
  });

  it('does not take a few quick frames for a faster display', () => {
    const governor = new QualityGovernor(1000 / 60, 0);
    for (let i = 0; i < 6000; i++) governor.frame(i % 15 === 0 ? 4 : 1000 / 60);
    expect(governor.level).toBe(0);
  });
});

describe('the display refresh probe', () => {
  it('on a 1x screen skips the steps that would only lower a resolution it does not have', () => {
    // At ratio 1 the first two levels draw the same, then the next three, then the last.
    const governor = new QualityGovernor(1000 / 60, 0, 1);
    const changes = run(governor, 1000 / 40, 400);
    expect(changes).toEqual([2, RENDER_LEVELS.length - 1]);
  });

  it('starts a remembered level at the best level that draws the same on this screen', () => {
    expect(new QualityGovernor(1000 / 60, 4, 1).level).toBe(2);
    expect(new QualityGovernor(1000 / 60, 4, 2).level).toBe(4);
  });

  it('never climbs back to a level that draws like one that fell behind', () => {
    const governor = new QualityGovernor(1000 / 60, 2, 1);
    // Behind at 2: down to the last level, then easy for long enough to try going up.
    expect(run(governor, 1000 / 40, 120)).toEqual([RENDER_LEVELS.length - 1]);
    expect(run(governor, 1000 / 60, 60 * 120)).toEqual([]);
    expect(governor.level).toBe(RENDER_LEVELS.length - 1);
  });

  it('judges afresh on another screen, from the best level that draws the same there', () => {
    const governor = new QualityGovernor(1000 / 60, 1, 2);
    expect(governor.setDeviceRatio(1)).toBe(0);
    expect(governor.level).toBe(0);
    expect(governor.setDeviceRatio(2)).toBeNull();
  });

  it('snaps the shortest frame interval to a standard refresh rate', () => {
    expect(snapRefreshInterval(16.4)).toBeCloseTo(1000 / 60, 5);
    expect(snapRefreshInterval(8.2)).toBeCloseTo(1000 / 120, 5);
    expect(snapRefreshInterval(6.8)).toBeCloseTo(1000 / 144, 5);
    expect(snapRefreshInterval(13.4)).toBeCloseTo(1000 / 75, 5);
    // A browser's frame cap, and the slow rates a MacBook's display can be set to.
    expect(snapRefreshInterval(33.4)).toBeCloseTo(1000 / 30, 5);
    expect(snapRefreshInterval(20.9)).toBeCloseTo(1000 / 48, 5);
    expect(snapRefreshInterval(20.1)).toBeCloseTo(1000 / 50, 5);
    // Nonsense (a throttled or hidden tab) falls back to 60 Hz.
    expect(snapRefreshInterval(Infinity)).toBeCloseTo(1000 / 60, 5);
  });
});
