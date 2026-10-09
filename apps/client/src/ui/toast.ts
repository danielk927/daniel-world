import { el } from './dom.ts';

/** Short-lived notices at the top of the screen. */
export class Toasts {
  readonly element: HTMLElement;

  constructor(parent: HTMLElement) {
    this.element = el('div', { class: 'toasts', attrs: { role: 'status', 'aria-live': 'polite' } });
    parent.append(this.element);
  }

  clear(): void {
    this.element.replaceChildren();
  }

  show(message: string, durationMs = 2600): void {
    // The same notice twice reads as a glitch: keep the one showing up a little longer instead.
    const showing = [...this.element.children].find(
      (child): child is HTMLElement =>
        child.textContent === message && !child.classList.contains('is-leaving'),
    );
    const toast = showing ?? el('div', { class: 'toast', text: message });
    if (!showing) this.element.append(toast);
    while (this.element.children.length > 3) this.element.firstElementChild?.remove();
    window.clearTimeout(Number(toast.dataset.timer));
    toast.dataset.timer = String(
      window.setTimeout(() => {
        toast.classList.add('is-leaving');
        setTimeout(() => toast.remove(), 400);
      }, durationMs),
    );
  }
}
