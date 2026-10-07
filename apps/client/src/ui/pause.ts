import {
  FOV_RANGE,
  SENSITIVITY_RANGE,
  type QualityChoice,
  type Settings,
} from '../game/settings.ts';
import type { Quality } from '../util/capabilities.ts';
import { el, trapFocus } from './dom.ts';

export interface PauseHandlers {
  /** `look`: take the mouse back for looking around (not after Esc; see InfoPanel). */
  onResume(look: boolean): void;
  onLeave(): void;
  onCopyInvite(): void;
}

const CONTROLS: readonly (readonly [string, string])[] = [
  ['WASD', 'Move'],
  ['Mouse', 'Look around'],
  ['Space', 'Jump'],
  ['Shift', 'Sprint'],
  ['Click', 'Throw a knife, or punch'],
  ['Q', 'Knife or bare hand'],
  ['I', 'Inspect the knife'],
  ['E', 'Open or close a station'],
  ['Enter', 'Chat'],
  ['Esc', 'Menu'],
];

const QUALITY_NAMES: Record<QualityChoice, string> = { auto: 'Auto', high: 'High', low: 'Low' };

/** One labelled row of the settings list. */
function row(label: string, id: string, control: HTMLElement, help?: HTMLElement): HTMLElement {
  return el('div', { class: 'setting' }, [
    el('label', { class: 'setting-label', text: label, attrs: { for: id } }),
    el('div', { class: 'setting-control' }, [control]),
    help ?? null,
  ]);
}

/**
 * The pause menu, laid out like a game's: who and where you are along the top, Settings and
 * Controls as tabs, Resume and Leave along the bottom. Settings apply as they change.
 */
export class PauseMenu {
  readonly element: HTMLElement;
  private readonly resumeButton = el('button', {
    class: 'button button-primary',
    text: 'Resume',
    attrs: { type: 'button' },
  });
  private readonly note = el('p', { class: 'pause-note' });
  private readonly status = el('p', { class: 'pause-status' });
  private readonly inviteButton = el('button', {
    class: 'button button-secondary',
    text: 'Copy invite link',
    attrs: { type: 'button' },
  });
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly panels: HTMLElement[] = [];
  private releaseFocus: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    handlers: PauseHandlers,
    settings: Settings,
    quality: { active: Quality; auto: Quality },
  ) {
    const leaveButton = el('button', {
      class: 'button button-secondary',
      text: 'Leave world',
      attrs: { type: 'button' },
    });
    const panels: [string, HTMLElement][] = [
      ['Settings', this.settingsPanel(settings, quality)],
      ['Controls', this.controlsPanel()],
    ];
    const tabList = el('div', { class: 'tabs', attrs: { role: 'tablist', 'aria-label': 'Menu' } });
    panels.forEach(([name, panel], i) => {
      const tab = el('button', {
        class: 'tab',
        text: name,
        attrs: {
          type: 'button',
          role: 'tab',
          id: `pause-tab-${i}`,
          'aria-controls': `pause-panel-${i}`,
        },
      });
      panel.id = `pause-panel-${i}`;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', tab.id);
      tab.addEventListener('click', () => this.select(i));
      tab.addEventListener('keydown', (event) => {
        // Arrow keys move between tabs, as in any tab list.
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const next = (i + (event.key === 'ArrowRight' ? 1 : -1) + panels.length) % panels.length;
        this.select(next);
        this.tabs[next]!.focus();
      });
      this.tabs.push(tab);
      this.panels.push(panel);
      tabList.append(tab);
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
          el('header', { class: 'pause-header' }, [
            el('h2', { class: 'card-title', text: 'Paused', attrs: { id: 'pause-title' } }),
            this.status,
          ]),
          this.note,
          tabList,
          ...this.panels,
          el('footer', { class: 'pause-footer' }, [
            this.resumeButton,
            leaveButton,
            this.inviteButton,
            el('a', {
              class: 'text-link pause-portfolio',
              text: 'Plain portfolio page',
              attrs: { href: '/portfolio.html' },
            }),
          ]),
        ]),
      ],
    );
    this.select(0);
    this.resumeButton.addEventListener('click', () => handlers.onResume(true));
    this.element.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.isOpen) return;
      event.preventDefault();
      event.stopPropagation();
      handlers.onResume(false);
    });
    leaveButton.addEventListener('click', () => handlers.onLeave());
    this.inviteButton.addEventListener('click', () => handlers.onCopyInvite());
    parent.append(this.element);
  }

  private select(index: number): void {
    this.tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      this.panels[i]!.hidden = !selected;
    });
  }

  private settingsPanel(
    settings: Settings,
    quality: { active: Quality; auto: Quality },
  ): HTMLElement {
    const values = settings.values;
    const slider = (
      id: string,
      key: 'sensitivity' | 'fov',
      range: readonly [number, number],
      step: number,
      format: (value: number) => string,
    ): HTMLElement => {
      const input = el('input', {
        class: 'slider',
        attrs: {
          id,
          type: 'range',
          min: String(range[0]),
          max: String(range[1]),
          step: String(step),
          value: String(values[key]),
        },
      });
      const output = el('output', {
        class: 'slider-value',
        text: format(values[key]),
        attrs: { for: id },
      });
      input.addEventListener('input', () => {
        const value = Number(input.value);
        output.textContent = format(value);
        settings.set(key, value);
      });
      return el('div', { class: 'slider-row' }, [input, output]);
    };

    const toggle = (id: string, key: 'invertY' | 'showFps' | 'reduceMotion'): HTMLElement => {
      const button = el(
        'button',
        {
          class: 'switch',
          attrs: { id, type: 'button', role: 'switch', 'aria-checked': String(values[key]) },
        },
        [el('span', { class: 'switch-thumb' })],
      );
      button.addEventListener('click', () => {
        const next = button.getAttribute('aria-checked') !== 'true';
        button.setAttribute('aria-checked', String(next));
        settings.set(key, next);
      });
      return button;
    };

    // Graphics apply on the next load: the scene is built for one tier.
    const resolve = (choice: QualityChoice): Quality => (choice === 'auto' ? quality.auto : choice);
    const qualityHelp = el('p', { class: 'setting-help' });
    const reload = el('button', {
      class: 'button button-secondary button-small',
      text: 'Reload now',
      attrs: { type: 'button' },
    });
    reload.addEventListener('click', () => location.reload());
    const describeQuality = (choice: QualityChoice): void => {
      const pending = resolve(choice) !== quality.active;
      qualityHelp.textContent = pending
        ? `Running on ${QUALITY_NAMES[quality.active]}. ${QUALITY_NAMES[resolve(choice)]} takes effect after a reload.`
        : `Running on ${QUALITY_NAMES[quality.active]}${choice === 'auto' ? ', chosen for this device' : ''}.`;
      reload.hidden = !pending;
    };
    const segmented = el('div', {
      class: 'segmented',
      attrs: { id: 'setting-quality', role: 'radiogroup', 'aria-label': 'Graphics' },
    });
    for (const choice of ['auto', 'high', 'low'] as const) {
      const option = el('button', {
        class: 'segment',
        text: QUALITY_NAMES[choice],
        attrs: { type: 'button', role: 'radio', 'aria-checked': String(values.quality === choice) },
      });
      option.addEventListener('click', () => {
        for (const other of segmented.children) other.setAttribute('aria-checked', 'false');
        option.setAttribute('aria-checked', 'true');
        settings.set('quality', choice);
        describeQuality(choice);
      });
      segmented.append(option);
    }
    describeQuality(values.quality);

    return el('div', { class: 'pause-panel settings-list' }, [
      row(
        'Mouse sensitivity',
        'setting-sensitivity',
        slider(
          'setting-sensitivity',
          'sensitivity',
          SENSITIVITY_RANGE,
          0.1,
          (v) => `${v.toFixed(1)}x`,
        ),
      ),
      row(
        'Field of view',
        'setting-fov',
        slider('setting-fov', 'fov', FOV_RANGE, 1, (v) => `${v}°`),
      ),
      row('Invert vertical look', 'setting-invert', toggle('setting-invert', 'invertY')),
      row(
        'Graphics',
        'setting-quality',
        segmented,
        el('div', { class: 'setting-help-row' }, [qualityHelp, reload]),
      ),
      row('Show frame rate', 'setting-fps', toggle('setting-fps', 'showFps')),
      row(
        'Reduce motion',
        'setting-motion',
        toggle('setting-motion', 'reduceMotion'),
        el('p', { class: 'setting-help', text: 'No head bob, camera shake or flashes.' }),
      ),
    ]);
  }

  private controlsPanel(): HTMLElement {
    return el('div', { class: 'pause-panel' }, [
      el(
        'dl',
        { class: 'controls-list' },
        CONTROLS.flatMap(([keys, action]) => [
          el('dt', {}, [el('kbd', { text: keys })]),
          el('dd', { text: action }),
        ]),
      ),
    ]);
  }

  /** Private rooms can be shared with a link. */
  setPrivateRoom(isPrivate: boolean): void {
    this.inviteButton.hidden = !isPrivate;
  }

  /** Where the player is and how the connection is, under the title. */
  setStatus(text: string): void {
    this.status.textContent = text;
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
