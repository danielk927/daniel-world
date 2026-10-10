import { el } from './dom.ts';

/**
 * One row of the controls: the keys (strings become key rings, `or` and `-` stay plain words, and
 * the arrows are drawn, as the fonts have none), and what they do.
 */
type Row = readonly [keys: readonly string[], action: string];

const ROWS: readonly Row[] = [
  [['W', 'A', 'S', 'D'], 'Walk and strafe'],
  [['Mouse', 'or', 'Left', 'Right'], 'Turn'],
  [['Click'], 'Fire'],
  [['E', 'or', 'Space'], 'Open doors and flip switches, face to face'],
  [['Shift'], 'Run'],
  [['1', '-', '7'], 'Weapons'],
  [['Tab'], 'Map'],
  [['`'], 'Menu: new game, save, load'],
  [['Esc'], 'Step away from the computer'],
];

const PLAIN = new Set(['or', '-']);
const SVG = 'http://www.w3.org/2000/svg';

/** An arrow key's ring: the arrow drawn, its name for screen readers. */
function arrowKey(direction: 'Left' | 'Right'): HTMLElement {
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 12 12');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(SVG, 'path');
  path.setAttribute(
    'd',
    direction === 'Left' ? 'M10 6H2.5M6 2.5 2.5 6 6 9.5' : 'M2 6h7.5M6 2.5 9.5 6 6 9.5',
  );
  svg.append(path);
  return el('kbd', { class: 'key-arrow' }, [
    svg,
    el('span', { class: 'visually-hidden', text: `${direction} arrow` }),
  ]);
}

function keys(list: readonly string[]): HTMLElement {
  return el(
    'dt',
    {},
    list.map((k) =>
      PLAIN.has(k)
        ? el('span', { text: k })
        : k === 'Left' || k === 'Right'
          ? arrowKey(k)
          : el('kbd', { text: k }),
    ),
  );
}

/**
 * How to play DOOM, over the computer's screen each time a cook sits down at it, on an even dim of
 * the view. The first key or click puts it away (and still reaches DOOM), leaving a one-line
 * reminder along the bottom.
 */
export class ComputerGuide {
  readonly element: HTMLElement;

  constructor(parent: HTMLElement) {
    this.element = el(
      'section',
      { class: 'computer-guide', attrs: { 'aria-labelledby': 'computer-guide-title', hidden: '' } },
      [
        el('div', { class: 'computer-guide-body' }, [
          el('h2', {
            class: 'title computer-guide-title',
            text: 'DOOM',
            attrs: { id: 'computer-guide-title' },
          }),
          el('span', { class: 'bar', attrs: { 'aria-hidden': 'true' } }),
          el('p', {
            class: 'computer-guide-lede',
            text: "The 1993 shareware episode, on a RISC-V computer emulated in your browser: DOOM's original C code, compiled to run on it.",
          }),
          el(
            'dl',
            { class: 'computer-guide-keys' },
            ROWS.map(([list, action]) => el('div', {}, [keys(list), el('dd', { text: action })])),
          ),
          el('p', { class: 'computer-guide-start', text: 'Press any key to play' }),
        ]),
      ],
    );
    parent.append(this.element);
  }

  get shown(): boolean {
    return !this.element.hidden;
  }

  show(): void {
    this.element.hidden = false;
  }

  hide(): void {
    this.element.hidden = true;
  }
}
