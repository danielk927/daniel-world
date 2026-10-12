import { MAX_HEALTH } from '@world/shared';
import { el } from './dom.ts';
import { heartIcon } from './icons.ts';

/** Health as a reading: "2 of 3". Held between none and all, and whole. */
export function healthText(health: number): string {
  return `${clampHealth(health)} of ${MAX_HEALTH}`;
}

/**
 * What a screen reader is told when a hit leaves `health`. Nothing for a knockout, which the card
 * that says who did it announces.
 */
export function healthAnnouncement(health: number): string {
  if (health <= 0) return '';
  return health === 1
    ? 'Hit. 1 health left, one more knocks you out.'
    : `Hit. ${health} health left.`;
}

function clampHealth(health: number): number {
  return Math.max(0, Math.min(MAX_HEALTH, Math.floor(health)));
}

/**
 * The health to show after being told `told` while showing `shown`, or null if that is not less:
 * within a life the bar only goes down, so a hit that arrives late or twice changes nothing.
 */
export function loweredTo(shown: number, told: number): number | null {
  const next = clampHealth(told);
  return next < shown ? next : null;
}

/**
 * This player's health, in the bottom right corner by the knife: a heart, and a segment for each hit
 * a knife takes to knock them out, whole while they have it and a hairline once it is gone. The last
 * one left turns to the warning color. A segment that goes pulses as it does.
 */
export class Health {
  readonly element: HTMLElement;
  private readonly segments: HTMLElement[];
  private readonly announcement = el('span', {
    class: 'visually-hidden',
    attrs: { role: 'status' },
  });
  private health = MAX_HEALTH;

  constructor(parent: HTMLElement) {
    this.segments = Array.from({ length: MAX_HEALTH }, () =>
      el('i', { class: 'health-segment is-full', attrs: { 'aria-hidden': 'true' } }),
    );
    this.element = el(
      'div',
      {
        class: 'health',
        attrs: {
          role: 'meter',
          'aria-label': 'Health',
          'aria-valuemin': '0',
          'aria-valuemax': String(MAX_HEALTH),
        },
      },
      [
        el('span', { class: 'health-heart' }, [heartIcon()]),
        el('span', { class: 'health-segments' }, this.segments),
      ],
    );
    // Beside the meter, not in it: a meter's children are not read out.
    parent.append(this.element, this.announcement);
    this.show(MAX_HEALTH);
  }

  /** How much health is shown, from none to all. */
  get value(): number {
    return this.health;
  }

  /** Back to the health there is, without a word or a pulse: a respawn, or a new room. */
  set(health: number): void {
    this.show(clampHealth(health));
    this.announcement.textContent = '';
  }

  /** A knife has hit, leaving `health`: the segment goes with a pulse, and a reader hears of it. */
  hurt(health: number): void {
    const before = this.health;
    const next = loweredTo(before, health);
    if (next === null) return;
    this.show(next);
    for (const [i, segment] of this.segments.entries()) {
      if (i < before && i >= this.health) {
        segment.classList.remove('is-pulsing');
        // Restart the animation even if the last hit's is still running.
        void segment.offsetWidth;
        segment.classList.add('is-pulsing');
      }
    }
    this.announcement.textContent = healthAnnouncement(this.health);
  }

  private show(health: number): void {
    this.health = health;
    this.element.dataset.health = String(health);
    this.element.setAttribute('aria-valuenow', String(health));
    this.element.setAttribute('aria-valuetext', healthText(health));
    for (const [i, segment] of this.segments.entries()) {
      segment.classList.toggle('is-full', i < health);
      if (i < health) segment.classList.remove('is-pulsing');
    }
  }
}
