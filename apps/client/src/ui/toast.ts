import { el } from './dom.ts';

/** Short-lived notices at the top of the screen. */
export class Toasts {
  private readonly element: HTMLElement;

  constructor(parent: HTMLElement) {
    this.element = el('div', { class: 'toasts', attrs: { role: 'status', 'aria-live': 'polite' } });
    parent.append(this.element);
  }

  clear(): void {
    this.element.replaceChildren();
  }

  show(message: string, durationMs = 2600): void {
    const toast = el('div', { class: 'toast', text: message });
    this.element.append(toast);
    while (this.element.children.length > 3) this.element.firstElementChild?.remove();
    setTimeout(() => {
      toast.classList.add('is-leaving');
      setTimeout(() => toast.remove(), 400);
    }, durationMs);
  }
}
