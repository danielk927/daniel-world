import { DEATH_SECONDS } from '@world/shared';
import { el } from './dom.ts';
import type { KillParty } from './killFeed.ts';

/**
 * The screen while a knife has this player down: who did it, and a bar running down to when they
 * get back up. It comes in a beat after the hit, once the flash and the fall have landed.
 */
export class Knockout {
  readonly element: HTMLElement;
  private readonly by = el('p', { class: 'knockout-name' });
  private readonly countdown = el('p', { class: 'knockout-countdown' });
  private readonly bar = el('div', { class: 'knockout-bar-fill' });
  private readonly hint = el('p', { class: 'knockout-hint', attrs: { hidden: '' } });
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.element = el(
      'div',
      { class: 'knockout', attrs: { role: 'status', 'aria-live': 'assertive', hidden: '' } },
      [
        el('div', { class: 'knockout-card' }, [
          el('p', { class: 'knockout-label', text: 'Knocked out by' }),
          this.by,
          el('div', { class: 'knockout-bar', attrs: { 'aria-hidden': 'true' } }, [this.bar]),
          this.countdown,
          this.hint,
        ]),
      ],
    );
    parent.append(this.element);
  }

  get isShown(): boolean {
    return !this.element.hidden;
  }

  /** `hint`, if any, is a line of advice under the countdown. */
  show(by: KillParty, hint = ''): void {
    this.by.textContent = by.name;
    this.hint.textContent = hint;
    this.hint.hidden = hint === '';
    this.by.style.setProperty('--player-color', by.color);
    const until = performance.now() + DEATH_SECONDS * 1000;
    const tick = (): void => {
      const seconds = Math.max(1, Math.ceil((until - performance.now()) / 1000));
      this.countdown.textContent = `Back on your feet in ${seconds}`;
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
  }
}
