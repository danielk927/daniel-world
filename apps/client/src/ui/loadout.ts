import { el } from './dom.ts';
import { fistIcon, knifeIcon } from './icons.ts';

/** Smallest change in readiness worth restyling for; the refill takes well under a second. */
const READINESS_STEP = 0.02;

/**
 * What is in hand and what Q switches to, in the bottom right corner like a shooter's loadout: the
 * knife over the bare hand, the one held bright and marked on the rail, the other dim with its key.
 * After a throw the knife fills back in as the next one is drawn.
 */
export class Loadout {
  readonly element: HTMLElement;
  private readonly knife: HTMLElement;
  private readonly hand: HTMLElement;
  private readonly fill: HTMLElement;
  private readonly announcement = el('span', {
    class: 'visually-hidden',
    attrs: { role: 'status' },
  });
  private armed: boolean | null = null;
  private readiness = 1;

  constructor(parent: HTMLElement) {
    this.fill = el('span', { class: 'loadout-fill' }, [knifeIcon()]);
    this.knife = el('div', { class: 'loadout-slot loadout-knife' }, [
      el('kbd', { text: 'Q' }),
      el('span', { class: 'loadout-icon' }, [knifeIcon(), this.fill]),
    ]);
    this.hand = el('div', { class: 'loadout-slot loadout-hand' }, [
      el('kbd', { text: 'Q' }),
      el('span', { class: 'loadout-icon' }, [fistIcon()]),
    ]);
    this.element = el('div', { class: 'loadout' }, [this.knife, this.hand, this.announcement]);
    parent.append(this.element);
    this.update(true, 1);
  }

  /** Call every frame; it only touches the page when something visible changes. */
  update(armed: boolean, readiness: number): void {
    if (armed !== this.armed) {
      this.armed = armed;
      this.knife.classList.toggle('is-active', armed);
      this.hand.classList.toggle('is-active', !armed);
      this.announcement.textContent = armed ? 'Holding the knife' : 'Holding the bare hand';
    }
    const next = readiness >= 1 ? 1 : Math.floor(readiness / READINESS_STEP) * READINESS_STEP;
    if (next !== this.readiness) {
      this.readiness = next;
      this.fill.style.setProperty('--ready', String(next));
    }
  }
}
