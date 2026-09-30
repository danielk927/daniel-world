import { describe, expect, it } from 'vitest';
import { TICK_RATE, TICK_SECONDS } from './constants.ts';

describe('constants', () => {
  it('derives tick length from tick rate', () => {
    expect(TICK_SECONDS * TICK_RATE).toBeCloseTo(1);
  });
});
