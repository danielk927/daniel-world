import { DEATH_SECONDS } from '@world/shared';
import { el } from './dom.ts';

/** The screen while a knife has this player down: who did it, and when they will be back up. */
export class Knockout {
  readonly element: HTMLElement;
  private readonly by = el('p', { class: 'knockout-by' });
  private readonly countdown = el('p', { class: 'knockout-countdown' });
  private timer = 0;

  constructor(parent: HTMLElement) {
    this.element = el(
      'div',
      { class: 'knockout', attrs: { role: 'status', 'aria-live': 'assertive', hidden: '' } },
      [
        el('div', { class: 'knockout-card' }, [
          el('h2', { class: 'knockout-title', text: 'Knocked out' }),
          this.by,
          this.countdown,
        ]),
      ],
    );
    parent.append(this.element);
  }

  get isShown(): boolean {
    return !this.element.hidden;
  }

  show(by: string): void {
    this.by.textContent = `by ${by}`;
    const until = performance.now() + DEATH_SECONDS * 1000;
    const tick = (): void => {
      const seconds = Math.max(1, Math.ceil((until - performance.now()) / 1000));
      this.countdown.textContent = `Back on your feet in ${seconds}`;
    };
    tick();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(tick, 200);
    this.element.hidden = false;
  }

  hide(): void {
    window.clearInterval(this.timer);
    this.element.hidden = true;
  }
}
