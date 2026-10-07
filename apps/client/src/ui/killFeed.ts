import { el } from './dom.ts';
import { knifeIcon } from './icons.ts';

/** Someone in a knockout, as the feed shows them. */
export interface KillParty {
  readonly name: string;
  readonly color: string;
  /** The room's resident, Chef Skinner. */
  readonly resident?: boolean;
}

const LIFETIME_MS = 5500;
const MAX_ENTRIES = 4;

/**
 * Who knocked out whom, in the top right corner under the player list, the way shooters do it:
 * thrower, knife, victim, each name in its cook's color. Lines this player is in stand out.
 */
export class KillFeed {
  readonly element = el('div', { class: 'kill-feed', attrs: { 'aria-live': 'polite' } });

  constructor(parent: HTMLElement) {
    parent.append(this.element);
  }

  add(thrower: KillParty, victim: KillParty, involvesSelf: boolean): void {
    const name = (party: KillParty) => {
      const span = el('span', { class: 'kill-name', text: party.name });
      span.style.setProperty('--player-color', party.color);
      return span;
    };
    const icon = el('span', { class: 'kill-icon' }, [knifeIcon()]);
    const entry = el('div', { class: `kill${involvesSelf ? ' is-self' : ''}` }, [
      name(thrower),
      icon,
      // Read as "Thrower knocked out Victim"; on screen the knife says it.
      el('span', { class: 'visually-hidden', text: ' knocked out ' }),
      name(victim),
    ]);
    this.element.append(entry);
    while (this.element.children.length > MAX_ENTRIES) this.element.firstElementChild?.remove();
    window.setTimeout(() => {
      entry.classList.add('is-leaving');
      window.setTimeout(() => entry.remove(), 500);
    }, LIFETIME_MS);
  }

  clear(): void {
    this.element.replaceChildren();
  }
}
