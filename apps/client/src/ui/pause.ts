import { el, trapFocus } from './dom.ts';

export interface PauseHandlers {
  onResume(): void;
  onLeave(): void;
  onSensitivity(value: number): void;
  onCopyInvite(): void;
}

const CONTROLS: readonly (readonly [string, string])[] = [
  ['WASD', 'Move'],
  ['Mouse', 'Look around'],
  ['Space', 'Jump'],
  ['Shift', 'Sprint'],
  ['Click', 'Throw a knife'],
  ['Q', 'Knife or bare hand'],
  ['I', 'Inspect what is in hand'],
  ['E', 'Open a station'],
  ['Enter', 'Chat'],
  ['1-3', 'Wave, dance, jump'],
  ['Esc', 'Menu'],
];

export class PauseMenu {
  readonly element: HTMLElement;
  private readonly resumeButton: HTMLButtonElement;
  private readonly slider: HTMLInputElement;
  private readonly note = el('p', { class: 'pause-note' });
  private readonly roomActions: HTMLElement;
  private readonly inviteButton = el('button', {
    class: 'button button-secondary pause-wide',
    text: 'Copy invite link',
    attrs: { type: 'button' },
  });
  private releaseFocus: (() => void) | null = null;

  constructor(parent: HTMLElement, handlers: PauseHandlers, sensitivity: number) {
    this.resumeButton = el('button', {
      class: 'button button-primary',
      text: 'Resume',
      attrs: { type: 'button' },
    });
    const leaveButton = el('button', {
      class: 'button button-secondary',
      text: 'Leave world',
      attrs: { type: 'button' },
    });
    this.roomActions = el('div', { class: 'pause-room-actions' }, [this.inviteButton]);
    this.slider = el('input', {
      class: 'slider',
      attrs: {
        id: 'sensitivity',
        type: 'range',
        min: '0.2',
        max: '3',
        step: '0.1',
        value: String(sensitivity),
      },
    });
    const sliderValue = el('output', {
      class: 'slider-value',
      text: `${sensitivity.toFixed(1)}x`,
      attrs: { for: 'sensitivity' },
    });

    this.element = el(
      'div',
      {
        class: 'overlay pause',
        attrs: {
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'pause-title',
          hidden: '',
        },
      },
      [
        el('div', { class: 'card pause-card' }, [
          el('h2', { class: 'card-title', text: 'Paused', attrs: { id: 'pause-title' } }),
          this.note,
          el('div', { class: 'pause-actions' }, [this.resumeButton, leaveButton]),
          this.roomActions,
          el('div', { class: 'field' }, [
            el('label', {
              class: 'field-label',
              text: 'Mouse sensitivity',
              attrs: { for: 'sensitivity' },
            }),
            el('div', { class: 'slider-row' }, [this.slider, sliderValue]),
          ]),
          el(
            'dl',
            { class: 'controls-list' },
            CONTROLS.flatMap(([keys, action]) => [
              el('dt', {}, [el('kbd', { text: keys })]),
              el('dd', { text: action }),
            ]),
          ),
          el('a', {
            class: 'text-link',
            text: 'Open the plain portfolio page',
            attrs: { href: '/portfolio.html' },
          }),
        ]),
      ],
    );
    this.resumeButton.addEventListener('click', () => handlers.onResume());
    this.element.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.isOpen) return;
      event.preventDefault();
      event.stopPropagation();
      handlers.onResume();
    });
    leaveButton.addEventListener('click', () => handlers.onLeave());
    this.inviteButton.addEventListener('click', () => handlers.onCopyInvite());
    this.slider.addEventListener('input', () => {
      const value = Number(this.slider.value);
      sliderValue.textContent = `${value.toFixed(1)}x`;
      handlers.onSensitivity(value);
    });
    parent.append(this.element);
  }

  /** Private rooms can be shared with a link. */
  setPrivateRoom(isPrivate: boolean): void {
    this.roomActions.hidden = !isPrivate;
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  show(note = ''): void {
    this.note.textContent = note;
    this.note.hidden = note === '';
    if (!this.element.hidden) return;
    this.element.hidden = false;
    this.releaseFocus = trapFocus(this.element);
    this.resumeButton.focus({ preventScroll: true });
  }

  hide(): void {
    if (this.element.hidden) return;
    if (this.element.contains(document.activeElement))
      (document.activeElement as HTMLElement).blur();
    this.element.hidden = true;
    this.releaseFocus?.();
    this.releaseFocus = null;
  }
}
