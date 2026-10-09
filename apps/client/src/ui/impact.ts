import { el } from './dom.ts';
import type { KillParty } from './killFeed.ts';

/** Play a CSS animation again from the start, even if it is still running. */
function replay(node: HTMLElement, className: string): void {
  node.classList.remove(className);
  void node.offsetWidth;
  node.classList.add(className);
}

/**
 * The screen's reactions to knives: a red flash when one hits this player, a blink as they get
 * back up, and for the thrower a hit marker on the crosshair and the victim's name under it.
 */
export class Impact {
  private readonly flash = el('div', { class: 'impact-flash', attrs: { 'aria-hidden': 'true' } });
  private readonly blinkLayer = el('div', {
    class: 'impact-blink',
    attrs: { 'aria-hidden': 'true' },
  });
  private readonly marker = el('div', { class: 'hit-marker', attrs: { 'aria-hidden': 'true' } }, [
    el('i'),
    el('i'),
    el('i'),
    el('i'),
  ]);
  private readonly bannerName = el('span', { class: 'hit-banner-name' });
  private readonly banner = el('div', { class: 'hit-banner', attrs: { role: 'status' } }, [
    el('span', { class: 'kicker hit-banner-label', text: 'Knocked out' }),
    this.bannerName,
  ]);
  private bannerTimer = 0;

  constructor(parent: HTMLElement) {
    parent.append(this.flash, this.blinkLayer, this.marker, this.banner);
  }

  /** A knife has hit this player. */
  hit(): void {
    replay(this.flash, 'is-playing');
  }

  /** Back on their feet, somewhere new. */
  blink(): void {
    replay(this.blinkLayer, 'is-playing');
  }

  /** This player's knife has knocked someone out. */
  landed(victim: KillParty): void {
    replay(this.marker, 'is-playing');
    this.bannerName.textContent = victim.name;
    this.bannerName.style.setProperty('--player-color', victim.color);
    replay(this.banner, 'is-visible');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('is-visible'), 1800);
  }

  clear(): void {
    for (const node of [this.flash, this.blinkLayer, this.marker])
      node.classList.remove('is-playing');
    this.banner.classList.remove('is-visible');
  }
}
