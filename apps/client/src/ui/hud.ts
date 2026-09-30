import { el } from './dom.ts';

/** Always-on in-world overlay: crosshair, interaction prompt and the controls hint. */
export class Hud {
  readonly element: HTMLElement;
  private readonly crosshair = el('div', { class: 'crosshair' });
  private readonly prompt = el('div', { class: 'prompt', attrs: { 'aria-live': 'polite' } });
  private readonly hint = el('div', { class: 'hint' }, [
    el('kbd', { text: 'WASD' }),
    ' move ',
    el('kbd', { text: 'Space' }),
    ' jump ',
    el('kbd', { text: 'Shift' }),
    ' sprint ',
    el('kbd', { text: 'Enter' }),
    ' chat ',
    el('kbd', { text: '1-3' }),
    ' emotes ',
    el('kbd', { text: 'Esc' }),
    ' menu',
  ]);
  private hintTimer = 0;
  private promptText = '';

  constructor(parent: HTMLElement) {
    this.element = el('div', { class: 'hud', attrs: { hidden: '' } }, [
      this.crosshair,
      this.prompt,
      this.hint,
    ]);
    parent.append(this.element);
  }

  show(): void {
    this.element.hidden = false;
    this.hint.classList.remove('is-faded');
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hint.classList.add('is-faded'), 12000);
  }

  hide(): void {
    this.element.hidden = true;
  }

  /** Text under the crosshair when an object can be clicked, or null to clear it. */
  setPrompt(text: string | null): void {
    const next = text ?? '';
    if (next === this.promptText) return;
    this.promptText = next;
    this.prompt.textContent = next;
    this.prompt.classList.toggle('is-visible', next !== '');
    this.crosshair.classList.toggle('is-active', next !== '');
  }
}
