import { describe, expect, it } from 'vitest';
import { MAX_HEALTH } from '@world/shared';
import { healthAnnouncement, healthText, loweredTo } from './health.ts';

describe('healthText', () => {
  it('says how much health there is of how much', () => {
    expect(healthText(MAX_HEALTH)).toBe('3 of 3');
    expect(healthText(1)).toBe('1 of 3');
    expect(healthText(0)).toBe('0 of 3');
  });

  it('keeps it between none and all, whatever it is told', () => {
    expect(healthText(-2)).toBe('0 of 3');
    expect(healthText(9)).toBe('3 of 3');
    expect(healthText(1.6)).toBe('1 of 3');
  });
});

describe('healthAnnouncement', () => {
  it('says what a hit leaves, in words', () => {
    expect(healthAnnouncement(2)).toBe('Hit. 2 health left.');
    expect(healthAnnouncement(1)).toBe('Hit. 1 health left, one more knocks you out.');
  });

  it('leaves the knockout to the card that says who did it', () => {
    expect(healthAnnouncement(0)).toBe('');
  });
});

describe('loweredTo', () => {
  it('takes a health below the one shown', () => {
    expect(loweredTo(3, 2)).toBe(2);
    expect(loweredTo(2, 1)).toBe(1);
    expect(loweredTo(1, 0)).toBe(0);
  });

  it('never gives health back: a hit told late, or twice, changes nothing', () => {
    expect(loweredTo(1, 2)).toBeNull();
    expect(loweredTo(1, 1)).toBeNull();
    expect(loweredTo(0, 1)).toBeNull();
    expect(loweredTo(3, 3)).toBeNull();
  });

  it('holds what it is told between none and all', () => {
    expect(loweredTo(3, -4)).toBe(0);
    expect(loweredTo(3, 9)).toBeNull();
    expect(loweredTo(3, 1.7)).toBe(1);
  });
});
