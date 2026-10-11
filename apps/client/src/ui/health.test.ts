import { describe, expect, it } from 'vitest';
import { MAX_HEALTH } from '@world/shared';
import { healthAnnouncement, healthText } from './health.ts';

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
