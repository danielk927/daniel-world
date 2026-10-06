import type { LoreEntry } from '../content.ts';
import { el, trapFocus } from './dom.ts';
import { renderLoreBody } from './loreContent.ts';

/** Slide-in info panel for a lore object. */
export class InfoPanel {
  readonly element: HTMLElement;
  /** `look`: take the mouse back for looking around. Not after Esc, which the browser owns. */
  onClose: ((look: boolean) => void) | null = null;
  private readonly kicker = el('p', { class: 'panel-kicker' });
  private readonly title = el('h2', { class: 'panel-title', attrs: { id: 'panel-title' } });
  private readonly body = el('div', { class: 'panel-body' });
  private readonly closeButton = el('button', {
    class: 'icon-button panel-close',
    attrs: { type: 'button', 'aria-label': 'Close' },
    text: '×',
  });
  private releaseFocus: (() => void) | null = null;
  current: LoreEntry | null = null;

  constructor(parent: HTMLElement) {
    this.element = el(
      'aside',
      {
        class: 'panel',
        attrs: {
          role: 'dialog',
          'aria-modal': 'true',
          'aria-labelledby': 'panel-title',
          hidden: '',
        },
      },
      [
        el('div', { class: 'panel-card', attrs: { tabindex: '-1' } }, [
          el('header', { class: 'panel-header' }, [
            el('div', {}, [this.kicker, this.title]),
            this.closeButton,
          ]),
          this.body,
          el('p', { class: 'panel-hint', text: 'Press E or Esc to close' }),
        ]),
      ],
    );
    this.closeButton.addEventListener('click', () => this.close(true));
    this.element.addEventListener('keydown', (event) => {
      if (!this.isOpen) return;
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
    this.element.style.setProperty('--accent-entry', entry.color);
    this.kicker.textContent = entry.kicker;
    this.title.textContent = entry.title;
    this.body.replaceChildren(renderLoreBody(entry));
    this.body.scrollTop = 0;
    this.element.hidden = false;
    // Next frame, so the slide-in transition runs.
    requestAnimationFrame(() => this.element.classList.add('open'));
    this.releaseFocus = trapFocus(this.element);
    this.element.querySelector<HTMLElement>('.panel-card')?.focus({ preventScroll: true });
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
}
