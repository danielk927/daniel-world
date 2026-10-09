import { describe, expect, it } from 'vitest';
import { StrikeCounter, TokenBucket } from './rateLimit.ts';

describe('TokenBucket', () => {
  it('allows a burst up to capacity, then refills over time', () => {
    let now = 0;
    const bucket = new TokenBucket(3, 2, () => now);
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
    now = 500; // half a second refills one token
    expect(bucket.take()).toBe(true);
    expect(bucket.take()).toBe(false);
    now = 60_000; // never exceeds capacity
    expect([bucket.take(), bucket.take(), bucket.take(), bucket.take()]).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });
});

describe('TokenBucket.wait', () => {
  it('says how long until a take would succeed', () => {
    let now = 0;
    const bucket = new TokenBucket(2, 4, () => now);
    expect(bucket.wait()).toBe(0);
    bucket.take();
    bucket.take();
    // Four a second: the next is a quarter of a second away, less whatever time has passed.
    expect(bucket.wait()).toBeCloseTo(250, 9);
    now = 100;
    expect(bucket.wait()).toBeCloseTo(150, 9);
    expect(bucket.take()).toBe(false);
    now = 250;
    expect(bucket.wait()).toBe(0);
    expect(bucket.take()).toBe(true);
  });
});

describe('StrikeCounter', () => {
  it('trips on sustained strikes but forgives slow ones', () => {
    let now = 0;
    const strikes = new StrikeCounter(3, 1, () => now);
    expect([strikes.add(), strikes.add(), strikes.add()]).toEqual([false, false, false]);
    expect(strikes.add()).toBe(true);

    const slow = new StrikeCounter(3, 1, () => now);
    for (let i = 0; i < 20; i++) {
      now += 1500;
      expect(slow.add()).toBe(false);
    }
  });
});
