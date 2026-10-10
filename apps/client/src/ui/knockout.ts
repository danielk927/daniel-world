import { DEATH_SECONDS } from '@world/shared';
import { el } from './dom.ts';
import type { KillParty } from './killFeed.ts';

/**
 * The screen while a knife has this player down: who did it, and a bar running down to when they
 * get back up, centered on the veiled view with nothing behind them. It comes in a beat after the
 * hit, once the flash and the fall have landed.
 */
export class Knockout {
  readonly element: HTMLElement;
  private readonly by = el('p', { class: 'knockout-name' });
  private readonly countdown = el('p', { class: 'knockout-countdown' });
  private readonly bar = el('div', { class: 'knockout-bar-fill' });
  private readonly hint = el('p', { class: 'knockout-hint', attrs: { hidden: '' } });
  /**
   * What a screen reader hears, once as the card shows: who did it, when the cook is back up, and
   * any advice. Always in the page, so it is heard as it changes, unlike the card, which comes and
   * goes, and whose countdown would be read out at every tick.
   */
  private readonly announcement = el('p', {
    class: 'visually-hidden',
    attrs: { role: 'status', 'aria-live': 'assertive' },
  });
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.element = el('div', { class: 'knockout', attrs: { 'aria-hidden': 'true', hidden: '' } }, [
      el('div', { class: 'knockout-body' }, [
        el('p', { class: 'kicker knockout-label', text: 'Knocked out by' }),
        this.by,
        el('div', { class: 'knockout-bar' }, [this.bar]),
        this.countdown,
        this.hint,
      ]),
    ]);
    parent.append(this.element, this.announcement);
  }

  /** `hint`, if any, is a line of advice under the countdown. */
  show(by: KillParty, hint = ''): void {
    this.by.textContent = by.name;
    this.hint.textContent = hint;
    this.hint.hidden = hint === '';
    this.by.style.setProperty('--player-color', by.color);
    this.announcement.textContent = [
      `Knocked out by ${by.name}.`,
      `Back on your feet in ${DEATH_SECONDS} seconds.`,
      hint,
    ]
      .filter(Boolean)
      .join(' ');
    const until = performance.now() + DEATH_SECONDS * 1000;
    const tick = (): void => {
      const seconds = Math.max(1, Math.ceil((until - performance.now()) / 1000));
      const text = `Back on your feet in ${seconds}`;
      if (this.countdown.textContent !== text) this.countdown.textContent = text;
    };
    tick();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(tick, 200);
    // The bar drains over the whole time down, the beat before the card included.
    this.bar.style.animationDuration = `${DEATH_SECONDS}s`;
    this.element.hidden = false;
    this.element.classList.remove('is-shown');
    void this.element.offsetWidth;
    this.element.classList.add('is-shown');
  }

  hide(): void {
    window.clearInterval(this.timer);
    this.element.classList.remove('is-shown');
    this.element.hidden = true;
    // Cleared, so the next knockout is a change to hear even if it says the same.
    this.announcement.textContent = '';
  }
}
