import { dishes, stations, type LoreEntry } from '../content.ts';
import { el, tabStops, trapFocus } from './dom.ts';
import { renderLoreBody } from './loreContent.ts';
import { toElement } from './markup.ts';

const stationIds: readonly string[] = Object.keys(stations);
const dishIds: readonly string[] = Object.keys(dishes);

/** Which of the stations (or of the dishes) an entry is, in the order the resume reads. */
function orderOf(entry: LoreEntry): { index: number; count: number } | null {
  const station = stationIds.indexOf(entry.id);
  if (station >= 0) return { index: station, count: stationIds.length };
  const dish = dishIds.indexOf(entry.id);
  if (dish >= 0) return { index: dish, count: dishIds.length };
  return null;
}

/**
 * A station's section of the resume, or a dish on the pass: a column docked to the right edge over
 * the darkened kitchen, the station still in view on the left. The title is the section, never the
 * station's French name.
 */
export class InfoPanel {
  readonly element: HTMLElement;
  /** `look`: take the mouse back for looking around. Not after Esc, which the browser owns. */
  onClose: ((look: boolean) => void) | null = null;
  private readonly title = el('h2', { class: 'title panel-title', attrs: { id: 'panel-title' } });
  /** Where a dish was eaten. Stations have nothing here. */
  private readonly where = el('p', { class: 'panel-where' });
  /** The scrolling part, focused on open so the arrow keys and Page Down read on at once. */
  private readonly body = el('div', { class: 'panel-body', attrs: { tabindex: '-1' } });
  private readonly count = el('p', { class: 'panel-count' });
  private readonly closeButton = el('button', {
    class: 'icon-button panel-close',
    attrs: { type: 'button', 'aria-label': 'Close' },
  });
  private releaseFocus: (() => void) | null = null;
  current: LoreEntry | null = null;

  constructor(parent: HTMLElement) {
    this.element = el(
      'aside',
      {
        class: 'panel',
        // Focusable, so a click on its words or the kitchen beside it keeps focus, and with it Esc
        // and E, in the panel.
        attrs: {
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'panel-title',
          tabindex: '-1',
          hidden: '',
        },
      },
      [
        el('div', { class: 'panel-column' }, [
          el('header', { class: 'panel-header' }, [
            this.title,
            el('span', { class: 'bar' }),
            this.where,
          ]),
          this.body,
          el('footer', { class: 'panel-footer' }, [
            el('p', { class: 'panel-keys' }, [
              el('kbd', { text: 'E' }),
              ' or ',
              el('kbd', { text: 'Esc' }),
              ' to close',
            ]),
            this.count,
          ]),
          // Last in the column, so Tab from the text reaches it after the links.
          this.closeButton,
        ]),
      ],
    );
    this.closeButton.addEventListener('click', () => this.close(true));
    this.element.addEventListener('keydown', (event) => {
      if (!this.isOpen) return;
      if (event.key === 'Tab') {
        this.tabFromBody(event);
        return;
      }
      // E closes it the way it opened, and the game goes straight back to looking around.
      const e = event.code === 'KeyE' && !event.repeat && !event.ctrlKey && !event.metaKey;
      if (event.key !== 'Escape' && !e) return;
      event.preventDefault();
      // The game also listens for these keys (Esc pauses); this press is only for the panel.
      event.stopPropagation();
      // Esc leaves the mouse free. Chrome on macOS releases pointer lock as Esc comes back up, so
      // a lock taken back during the press is lost at once, and losing it would open the pause menu.
      this.close(e);
    });
    parent.append(this.element);
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  open(entry: LoreEntry): void {
    this.current = entry;
    this.title.textContent = entry.title;
    this.where.textContent = entry.place ?? '';
    this.where.hidden = !entry.place;
    const order = orderOf(entry);
    this.count.replaceChildren(
      ...(order ? [el('span', { text: String(order.index + 1) }), ` of ${order.count}`] : []),
    );
    this.body.replaceChildren(toElement(renderLoreBody(entry)));
    this.element.hidden = false;
    // Only once it shows: a hidden panel ignores this, and would open where the last one was left.
    this.body.scrollTop = 0;
    // Next frame, so the slide-in transition runs.
    requestAnimationFrame(() => this.element.classList.add('open'));
    this.releaseFocus = trapFocus(this.element);
    this.body.focus({ preventScroll: true });
  }

  close(look = false): void {
    if (!this.current) return;
    this.current = null;
    // Give focus back to the page, or keys would keep landing on the hidden panel.
    if (this.element.contains(document.activeElement))
      (document.activeElement as HTMLElement).blur();
    this.element.classList.remove('open');
    this.element.hidden = true;
    this.releaseFocus?.();
    this.releaseFocus = null;
    this.onClose?.(look);
  }

  /**
   * Tab from the text itself, where focus starts, goes to the first link or the close button, and
   * Shift+Tab to the last: neither way leaves the dialog. The focus trap handles the rest.
   */
  private tabFromBody(event: KeyboardEvent): void {
    if (document.activeElement !== this.body) return;
    const focusable = tabStops(this.element);
    const next = event.shiftKey ? focusable.at(-1) : focusable[0];
    if (!next) return;
    event.preventDefault();
    next.focus();
  }
}
