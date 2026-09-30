import type { LoreEntry } from '../content.ts';
import { el, trapFocus } from './dom.ts';
import { renderLoreBody } from './loreContent.ts';

/** Slide-in info panel for a lore object. */
export class InfoPanel {
  readonly element: HTMLElement;
  onClose: (() => void) | null = null;
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
          el('p', { class: 'panel-hint', text: 'Press Esc to close' }),
        ]),
      ],
    );
    this.closeButton.addEventListener('click', () => this.close());
    this.element.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.close();
      }
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

  close(): void {
    if (!this.current) return;
    this.current = null;
    this.element.classList.remove('open');
    this.element.hidden = true;
    this.releaseFocus?.();
    this.releaseFocus = null;
    this.onClose?.();
  }
}
