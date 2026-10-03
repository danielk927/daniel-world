import { el } from './dom.ts';

const SVG = 'http://www.w3.org/2000/svg';

function svg(viewBox: string, shapes: readonly (readonly [string, Record<string, string>])[]) {
  const root = document.createElementNS(SVG, 'svg');
  root.setAttribute('viewBox', viewBox);
  root.setAttribute('aria-hidden', 'true');
  for (const [tag, attrs] of shapes) {
    const shape = document.createElementNS(SVG, tag);
    for (const [name, value] of Object.entries(attrs)) shape.setAttribute(name, value);
    root.append(shape);
  }
  return root;
}

/** A chef's knife side on, tip to the left: the blade's belly curving up to the tip, two rivets. */
function knifeIcon(): SVGSVGElement {
  return svg('0 0 76 20', [
    ['path', { d: 'M1 8.2 L47 4 V15.6 C31 15.6 12 13.6 1 8.2 Z' }],
    ['rect', { x: '47', y: '3.4', width: '3.2', height: '12.8', rx: '0.8' }],
    ['rect', { x: '50.2', y: '5.6', width: '25', height: '8.4', rx: '3' }],
    ['circle', { class: 'loadout-rivet', cx: '58', cy: '9.8', r: '1.25' }],
    ['circle', { class: 'loadout-rivet', cx: '67', cy: '9.8', r: '1.25' }],
  ]);
}

/** A clenched fist from the front: four knuckles over the palm, the thumb folded across. */
function fistIcon(): SVGSVGElement {
  return svg('0 0 30 26', [
    ['rect', { x: '4', y: '9', width: '24', height: '16', rx: '5' }],
    ['rect', { class: 'loadout-cut', x: '4', y: '2', width: '6.5', height: '11', rx: '3.2' }],
    ['rect', { class: 'loadout-cut', x: '9.8', y: '1', width: '6.5', height: '12', rx: '3.2' }],
    [
      'rect',
      { class: 'loadout-cut', x: '15.6', y: '1.5', width: '6.5', height: '11.5', rx: '3.2' },
    ],
    ['rect', { class: 'loadout-cut', x: '21.4', y: '3', width: '6.5', height: '10', rx: '3.2' }],
    ['rect', { class: 'loadout-cut', x: '1', y: '12.5', width: '17', height: '6.5', rx: '3.2' }],
  ]);
}

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
