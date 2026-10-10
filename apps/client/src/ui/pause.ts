import { DEFAULT_ROOM } from '@world/shared';
import {
  FOV_RANGE,
  SENSITIVITY_RANGE,
  type QualityChoice,
  type Settings,
} from '../game/settings.ts';
import type { Quality } from '../util/capabilities.ts';
import { el, trapFocus } from './dom.ts';
import { KnivesPanel } from './knivesPanel.ts';
import { PartyPanel, type PartyAvailability, type PartyHandlers } from './party.ts';

export interface PauseHandlers extends PartyHandlers {
  /** `look`: take the mouse back for looking around (not after Esc; see InfoPanel). */
  onResume(look: boolean): void;
  onLeave(): void;
}

/** Each action and the key that does it, a ring round it as in the HUD. */
const CONTROLS: readonly (readonly [string, string])[] = [
  ['Move', 'WASD'],
  ['Look around', 'Mouse'],
  ['Jump', 'Space'],
  ['Sprint', 'Shift'],
  ['Throw a knife, or punch', 'Click'],
  ['Knife or bare hand', 'Q'],
  ['Inspect the knife', 'I'],
  ['Open or close a station', 'E'],
  ['Chat', 'Enter'],
  ['Menu', 'Esc'],
];

const QUALITY_CHOICES = ['auto', 'high', 'low'] as const;
const QUALITY_NAMES: Record<QualityChoice, string> = { auto: 'Auto', high: 'High', low: 'Low' };

/** How long the menu's frame rate readout counts frames before it says how many. */
const FPS_WINDOW = 0.5;

/**
 * One row of a tab: the label (help under it) on the left, the control on the right, with a
 * readout `before` or `after` it. A control a label can name (an input, a button) gets a
 * `<label>`; a group is named by the label's id. The help describes the control.
 */
function row(
  label: string,
  control: HTMLElement,
  extra: { help?: HTMLElement; before?: HTMLElement; after?: HTMLElement } = {},
): HTMLElement {
  const id = control.id;
  const labelable = control instanceof HTMLInputElement || control instanceof HTMLButtonElement;
  const name = labelable
    ? el('label', { class: 'setting-label', text: label, attrs: { for: id } })
    : el('span', { class: 'setting-label', text: label, attrs: { id: `${id}-label` } });
  if (!labelable) control.setAttribute('aria-labelledby', `${id}-label`);
  const { help } = extra;
  const description = help?.matches('.setting-help') ? help : help?.querySelector('.setting-help');
  if (description) {
    description.id ||= `${id}-help`;
    control.setAttribute('aria-describedby', description.id);
  }
  return el('div', { class: 'setting' }, [
    name,
    el('div', { class: 'setting-control' }, [extra.before ?? null, control, extra.after ?? null]),
    help ?? null,
  ]);
}

/**
 * Move through a group of options with the arrow keys, either way, choosing as it goes: the
 * keyboard of a radio group, and of the tab list.
 */
function arrowTo(
  event: KeyboardEvent,
  index: number,
  count: number,
  go: (to: number) => void,
): void {
  const steps: Record<string, number> = {
    ArrowDown: index + 1,
    ArrowRight: index + 1,
    ArrowUp: index - 1,
    ArrowLeft: index - 1,
    Home: 0,
    End: count - 1,
  };
  const target = steps[event.key];
  if (target === undefined) return;
  event.preventDefault();
  go((target + count) % count);
}

/**
 * The pause menu, laid out like a game's: on the dark side of the screen, the state of play and
 * the room along the top, Party, Knives, Settings and Controls as a list of tabs with the open one
 * to their right, and Resume and Leave at the bottom. Settings apply as they change.
 */
export class PauseMenu {
  readonly element: HTMLElement;
  private readonly resumeButton = el('button', {
    class: 'button pause-resume',
    text: 'Resume',
    attrs: { type: 'button', 'aria-keyshortcuts': 'Escape' },
  });
  private readonly note = el('p', { class: 'pause-note' });
  private readonly status = el('p', { class: 'kicker pause-status', text: 'Paused' });
  private readonly title = el('h2', { class: 'title pause-title' });
  private readonly party: PartyPanel;
  private readonly knives: KnivesPanel;
  private selected = 0;
  private readonly tabs: HTMLButtonElement[] = [];
  private readonly panels: HTMLElement[] = [];
  private releaseFocus: (() => void) | null = null;
  /** The frame rate readout beside its switch, counted only while the menu is open with it on. */
  private readonly fps = el('span', { class: 'setting-value pause-fps' });
  private showFps = false;
  private fpsFrame = 0;
  private fpsFrames = 0;
  private fpsSince = 0;

  constructor(
    parent: HTMLElement,
    handlers: PauseHandlers,
    settings: Settings,
    quality: { active: Quality; auto: Quality },
  ) {
    const leaveButton = el('button', {
      class: 'button',
      text: 'Leave the kitchen',
      attrs: { type: 'button' },
    });
    this.party = new PartyPanel(handlers);
    this.knives = new KnivesPanel(settings);
    const panels: [string, HTMLElement][] = [
      ['Party', this.party.element],
      ['Knives', this.knives.element],
      ['Settings', this.settingsPanel(settings, quality)],
      ['Controls', this.controlsPanel()],
    ];
    const tabList = el('div', {
      class: 'pause-tabs',
      attrs: { role: 'tablist', 'aria-label': 'Menu', 'aria-orientation': 'vertical' },
    });
    panels.forEach(([name, panel], i) => {
      const tab = el('button', {
        class: 'pause-tab',
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
      // The list runs down the side, or across the top on a phone: arrows move along it either way.
      tab.addEventListener('keydown', (event) =>
        arrowTo(event, i, panels.length, (next) => {
          this.select(next);
          this.tabs[next]!.focus();
        }),
      );
      this.tabs.push(tab);
      this.panels.push(panel);
      tabList.append(tab);
    });

    this.element = el(
      'div',
      {
        class: 'pause',
        // Named for what it is; the title on screen is the room. Focusable, so a click on its words
        // or its dark keeps focus, and with it Esc, in the menu.
        attrs: {
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': 'Paused',
          tabindex: '-1',
          hidden: '',
        },
      },
      [
        el('div', { class: 'pause-frame' }, [
          el('header', { class: 'pause-head' }, [
            this.status,
            this.title,
            el('span', { class: 'bar pause-bar', attrs: { 'aria-hidden': 'true' } }),
            this.note,
          ]),
          tabList,
          el('div', { class: 'pause-panels' }, this.panels),
          el('footer', { class: 'pause-actions' }, [
            // The key that resumes, as a ring; the button carries it as its shortcut.
            el('kbd', { class: 'pause-esc', text: 'Esc', attrs: { 'aria-hidden': 'true' } }),
            this.resumeButton,
            leaveButton,
            el('a', {
              class: 'text-link pause-portfolio',
              text: 'Plain portfolio',
              attrs: { href: '/portfolio.html' },
            }),
          ]),
        ]),
      ],
    );
    this.select(0);
    this.setRoom(DEFAULT_ROOM, null);
    this.resumeButton.addEventListener('click', () => handlers.onResume(true));
    this.element.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || !this.isOpen) return;
      event.preventDefault();
      event.stopPropagation();
      handlers.onResume(false);
    });
    leaveButton.addEventListener('click', () => handlers.onLeave());
    settings.subscribe((values) => {
      this.showFps = values.showFps;
      this.syncFps();
    });
    parent.append(this.element);
  }

  private select(index: number): void {
    this.selected = index;
    this.tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      this.panels[i]!.hidden = !selected;
    });
    this.syncKnives();
  }

  /** The Knives page draws its preview only while it is on screen. */
  private syncKnives(): void {
    this.knives.setActive(this.isOpen && this.panels[this.selected] === this.knives.element);
  }

  /** Count frames for the readout while it can be seen; the HUD's own is covered by the menu. */
  private syncFps(): void {
    const counting = this.isOpen && this.showFps;
    this.fps.hidden = !this.showFps;
    if (counting === (this.fpsFrame !== 0)) return;
    cancelAnimationFrame(this.fpsFrame);
    this.fpsFrame = 0;
    if (!counting) return;
    this.fps.textContent = '';
    this.fpsFrames = 0;
    this.fpsSince = performance.now();
    this.fpsFrame = requestAnimationFrame(this.countFrame);
  }

  private readonly countFrame = (now: number): void => {
    this.fpsFrame = requestAnimationFrame(this.countFrame);
    this.fpsFrames++;
    const seconds = (now - this.fpsSince) / 1000;
    if (seconds < FPS_WINDOW) return;
    this.fps.textContent = `${Math.round(this.fpsFrames / seconds)} fps`;
    this.fpsFrames = 0;
    this.fpsSince = now;
  };

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
    ): [HTMLInputElement, HTMLElement] => {
      const input = el('input', {
        class: 'pause-slider',
        attrs: {
          id,
          type: 'range',
          min: String(range[0]),
          max: String(range[1]),
          step: String(step),
          value: String(values[key]),
        },
      });
      const output = el('output', { class: 'setting-value', attrs: { for: id } });
      // The brass run up to the knob, which the track's own styling cannot know.
      const show = (value: number): void => {
        output.textContent = format(value);
        input.style.setProperty('--run', String((value - range[0]) / (range[1] - range[0])));
      };
      input.addEventListener('input', () => {
        const value = Number(input.value);
        show(value);
        settings.set(key, value);
      });
      show(values[key]);
      return [input, output];
    };

    /** A switch reads as the two words Off and On, the bar under the one it is. */
    const toggle = (
      id: string,
      key: 'invertY' | 'showFps' | 'reduceMotion' | 'chefThrows',
    ): HTMLButtonElement => {
      const word = (text: string, value: boolean): HTMLElement =>
        el('span', { class: 'switch-word', text, attrs: { 'data-value': String(value) } });
      const button = el(
        'button',
        {
          class: 'switch',
          attrs: { id, type: 'button', role: 'switch', 'aria-checked': String(values[key]) },
        },
        [
          el('span', { class: 'switch-words', attrs: { 'aria-hidden': 'true' } }, [
            word('Off', false),
            word('On', true),
          ]),
        ],
      );
      button.addEventListener('click', (event) => {
        // A word clicked says which; a key, or the label, flips it.
        const word = (event.target as Element).closest('[data-value]');
        const next = word
          ? word.getAttribute('data-value') === 'true'
          : button.getAttribute('aria-checked') !== 'true';
        button.setAttribute('aria-checked', String(next));
        settings.set(key, next);
      });
      return button;
    };

    // Graphics apply on the next load: the scene is built for one tier.
    const resolve = (choice: QualityChoice): Quality => (choice === 'auto' ? quality.auto : choice);
    const qualityHelp = el('p', { class: 'setting-help' });
    const reload = el('button', {
      class: 'button setting-action',
      text: 'Reload now',
      attrs: { type: 'button' },
    });
    reload.addEventListener('click', () => location.reload());
    const describeQuality = (choice: QualityChoice): void => {
      const pending = resolve(choice) !== quality.active;
      const active = QUALITY_NAMES[quality.active];
      qualityHelp.textContent = pending
        ? `Running on ${active}. ${QUALITY_NAMES[resolve(choice)]} takes effect after a reload.`
        : choice === 'auto'
          ? `Auto chose ${active} for this device.`
          : `Running on ${active}.`;
      reload.hidden = !pending;
    };
    const options = QUALITY_CHOICES.map((choice) =>
      el('button', {
        class: 'choice',
        text: QUALITY_NAMES[choice],
        attrs: { type: 'button', role: 'radio' },
      }),
    );
    const mark = (chosen: QualityChoice): void => {
      options.forEach((option, i) => {
        const checked = QUALITY_CHOICES[i] === chosen;
        option.setAttribute('aria-checked', String(checked));
        option.tabIndex = checked ? 0 : -1;
      });
      describeQuality(chosen);
    };
    options.forEach((option, i) => {
      option.addEventListener('click', () => {
        mark(QUALITY_CHOICES[i]!);
        settings.set('quality', QUALITY_CHOICES[i]!);
      });
      option.addEventListener('keydown', (event) =>
        arrowTo(event, i, options.length, (next) => {
          options[next]!.click();
          options[next]!.focus();
        }),
      );
    });
    const choices = el(
      'div',
      { class: 'choices', attrs: { id: 'setting-quality', role: 'radiogroup' } },
      options,
    );
    mark(values.quality);

    const [sensitivity, sensitivityValue] = slider(
      'setting-sensitivity',
      'sensitivity',
      SENSITIVITY_RANGE,
      0.1,
      (v) => `${v.toFixed(1)}×`,
    );
    const [fov, fovValue] = slider('setting-fov', 'fov', FOV_RANGE, 1, (v) => `${v}°`);
    return el('div', { class: 'pause-panel settings-list' }, [
      row('Mouse sensitivity', sensitivity, { after: sensitivityValue }),
      row('Field of view', fov, { after: fovValue }),
      row('Invert vertical look', toggle('setting-invert', 'invertY')),
      row('Graphics', choices, {
        help: el('div', { class: 'setting-help-row' }, [qualityHelp, reload]),
      }),
      row('Show frame rate', toggle('setting-fps', 'showFps'), { before: this.fps }),
      row('Reduce motion', toggle('setting-motion', 'reduceMotion'), {
        help: el('p', { class: 'setting-help', text: 'No head bob, camera shake or flashes.' }),
      }),
      row('Chef Skinner throws knives at me', toggle('setting-chef', 'chefThrows'), {
        help: el('p', {
          class: 'setting-help',
          text: "The lobby's head chef. Off, neither of you can hit the other.",
        }),
      }),
    ]);
  }

  private controlsPanel(): HTMLElement {
    return el('div', { class: 'pause-panel' }, [
      el(
        'dl',
        { class: 'pause-controls' },
        CONTROLS.map(([action, key]) =>
          el('div', { class: 'setting' }, [
            el('dt', { class: 'setting-label', text: action }),
            el('dd', { class: 'setting-control' }, [el('kbd', { text: key })]),
          ]),
        ),
      ),
    ]);
  }

  /** The room the player is in, and the link that invites others to it (null for the lobby). */
  setRoom(room: string, inviteLink: string | null): void {
    const name = inviteLink === null ? 'The lobby' : `#${room}`;
    this.title.textContent = name;
    // A long party code steps the title down a size, so it stays on one line where it can.
    this.title.classList.toggle('is-long', name.length > 12);
    this.party.setRoom(room, inviteLink);
  }

  /** Whether parties can be started or joined, as the connection allows. */
  setPartyAvailability(availability: PartyAvailability): void {
    this.party.setAvailability(availability);
  }

  /**
   * How the connection is, over the title: "The lobby · Online · 4 ms" as the game says it. The
   * room it starts with is the title, so the line says Paused in its place.
   */
  setStatus(text: string): void {
    const [, ...connection] = text.split(' · ');
    // The dots between the parts are set apart a little more than a space would.
    this.status.replaceChildren(
      ...['Paused', ...connection].flatMap((part, i) =>
        i === 0 ? [part] : [el('span', { class: 'pause-status-dot', text: ' · ' }), part],
      ),
    );
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
    // Focus waits on Resume for Enter; its ring shows once the keyboard moves it.
    this.resumeButton.focus({ preventScroll: true, focusVisible: false });
    this.syncKnives();
    this.syncFps();
  }

  hide(): void {
    if (this.element.hidden) return;
    if (this.element.contains(document.activeElement))
      (document.activeElement as HTMLElement).blur();
    this.element.hidden = true;
    this.releaseFocus?.();
    this.releaseFocus = null;
    this.syncKnives();
    this.syncFps();
  }
}
