import { el } from './dom.ts';

/** One row of the controls: the keys (strings become keycaps, `or` and `-` stay plain), and what they do. */
type Row = readonly [keys: readonly string[], action: string];

const ROWS: readonly Row[] = [
  [['W', 'A', 'S', 'D'], 'Walk and strafe'],
  [['Mouse', 'or', '←', '→'], 'Turn'],
  [['Click', 'or', 'Ctrl'], 'Fire'],
  [['E', 'or', 'Space'], 'Open doors and flip switches, face to face'],
  [['Shift'], 'Run'],
  [['1', '-', '7'], 'Weapons'],
  [['Tab'], 'Map'],
  [['`'], 'Menu: new game, save, load'],
  [['Esc'], 'Step away from the computer'],
];

const PLAIN = new Set(['or', '-']);

function keys(list: readonly string[]): HTMLElement {
  return el(
    'dt',
    {},
    list.map((k) => (PLAIN.has(k) ? el('span', { text: k }) : el('kbd', { text: k }))),
  );
}

/**
 * How to play DOOM, over the computer's screen each time a cook sits down at it. The first key or
 * click puts it away (and still reaches DOOM), leaving a one-line reminder along the bottom.
 */
export class ComputerGuide {
  readonly element: HTMLElement;

  constructor(parent: HTMLElement) {
    this.element = el(
      'section',
      { class: 'computer-guide', attrs: { 'aria-labelledby': 'computer-guide-title', hidden: '' } },
      [
        el('p', { class: 'computer-guide-kicker', text: 'Kitchen PC' }),
        el('h2', {
          class: 'computer-guide-title',
          text: 'DOOM',
          attrs: { id: 'computer-guide-title' },
        }),
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
