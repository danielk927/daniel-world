import { describe, expect, it } from 'vitest';
import { KEYFRAMES, lookAt, pinnedHour, visitorHour } from './timeOfDay.ts';

describe('the time of day', () => {
  it('is each keyframe exactly at its hour', () => {
    for (const [hour, look] of KEYFRAMES) {
      const at = lookAt(hour);
      expect(at.stars).toBeCloseTo(look.stars);
      expect(at.cool[2]!.getHexString()).toBe(look.cool[2]!.getHexString());
    }
  });

  it('blends between keyframes, and round midnight', () => {
    // Halfway from the last night keyframe at 23:00 round to 00:00, still night.
    expect(lookAt(23.5).lamps).toBeCloseTo(1);
    // Mid-morning is between dawn and morning.
    const dawn = lookAt(6);
    const morning = lookAt(8);
    const between = lookAt(7);
    expect(between.ambient).toBeGreaterThan(dawn.ambient);
    expect(between.ambient).toBeLessThan(morning.ambient);
    expect(lookAt(31).ambient).toBeCloseTo(between.ambient);
  });

  it('has stars and lamps by night, and none by day', () => {
    expect(lookAt(2).stars).toBe(1);
    expect(lookAt(13).stars).toBe(0);
    expect(lookAt(13).lamps).toBe(0);
    expect(lookAt(20).lamps).toBeGreaterThan(0.9);
    // Daylight through the windows is much stronger than the evening's.
    expect(lookAt(13).windowStrength).toBeGreaterThan(1.4);
  });

  it("is the visitor's local time, unless ?time= pins it", () => {
    const now = new Date(2026, 9, 7, 14, 45, 0);
    expect(visitorHour(now, '')).toBeCloseTo(14.75);
    expect(visitorHour(now, '?time=21:30')).toBeCloseTo(21.5);
    expect(visitorHour(now, '?time=6')).toBeCloseTo(6);
    expect(pinnedHour('?time=25:00')).toBeNull();
    expect(pinnedHour('?time=noon')).toBeNull();
    expect(visitorHour(now, '?time=99')).toBeCloseTo(14.75);
  });
});
