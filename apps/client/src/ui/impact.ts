import { el } from './dom.ts';
import type { KillParty } from './killFeed.ts';

/**
 * Play a CSS animation again from the start, even if it is still running, or one of the `others`
 * that share the node.
 */
function replay(node: HTMLElement, className: string, ...others: string[]): void {
  node.classList.remove(className, ...others);
  void node.offsetWidth;
  node.classList.add(className);
}

/**
 * The screen's reactions to knives: a red flash when one hits this player (a short flare for a hit,
 * a long one for the knockout), a blink as they get back up, and for the thrower a hit marker on the
 * crosshair, and the victim's name under it when the hit knocked them out.
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

  /** A knife has knocked this player out. */
  hit(): void {
    replay(this.flash, 'is-playing', 'is-hurt');
  }

  /** A knife has hit this player, who is still standing: a short flare of the screen's edges. */
  hurt(): void {
    replay(this.flash, 'is-hurt', 'is-playing');
  }

  /** Back on their feet, somewhere new. */
  blink(): void {
    replay(this.blinkLayer, 'is-playing');
  }

  /** This player's knife has hit someone, who is still standing. */
  struck(): void {
    replay(this.marker, 'is-playing');
  }

  /** This player's knife has knocked someone out. */
  landed(victim: KillParty): void {
    this.struck();
    this.bannerName.textContent = victim.name;
    this.bannerName.style.setProperty('--player-color', victim.color);
    replay(this.banner, 'is-visible');
    window.clearTimeout(this.bannerTimer);
    this.bannerTimer = window.setTimeout(() => this.banner.classList.remove('is-visible'), 1800);
  }

  clear(): void {
    this.flash.classList.remove('is-hurt');
    for (const node of [this.flash, this.blinkLayer, this.marker])
      node.classList.remove('is-playing');
    this.banner.classList.remove('is-visible');
  }
}
