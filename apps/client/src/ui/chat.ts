import { CHAT_MAX_LENGTH } from '@world/shared';
import { el } from './dom.ts';

const MAX_LINES = 60;
/** Messages stay visible this long after the last activity while the chat is closed. */
const FADE_AFTER_MS = 10_000;

export interface ChatHandlers {
  onSend(text: string): void;
  onClose(): void;
}

/** Chat log in the bottom-left corner and the line to write on that Enter opens. Plain text only. */
export class Chat {
  readonly element: HTMLElement;
  private readonly log = el('ol', {
    class: 'chat-log',
    attrs: { 'aria-live': 'polite', 'aria-label': 'Chat history' },
  });
  private readonly input: HTMLInputElement;
  private readonly form: HTMLFormElement;
  private readonly counter = el('span', {
    class: 'chat-counter',
    attrs: { 'aria-hidden': 'true' },
  });
  private fadeTimer = 0;
  private readonly handlers: ChatHandlers;

  constructor(parent: HTMLElement, handlers: ChatHandlers) {
    this.handlers = handlers;
    this.input = el('input', {
      class: 'input chat-input',
      attrs: {
        type: 'text',
        maxlength: String(CHAT_MAX_LENGTH),
        autocomplete: 'off',
        spellcheck: 'false',
        placeholder: 'Say something…',
        'aria-label': 'Chat message',
        enterkeyhint: 'send',
      },
    });
    this.form = el('form', { class: 'chat-form', attrs: { hidden: '' } }, [
      this.input,
      this.counter,
    ]);
    this.element = el('div', { class: 'chat', attrs: { hidden: '' } }, [this.log, this.form]);

    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      const text = this.input.value.trim();
      this.input.value = '';
      if (text) this.handlers.onSend(text);
      this.close();
    });
    this.input.addEventListener('input', () => this.updateCounter());
    // Clicking away (e.g. on the world) ends the chat instead of leaving the game waiting for it.
    this.input.addEventListener('blur', () => this.close());
    this.input.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        this.close();
      }
      // Keep game shortcuts (like Q, I and E) from firing while typing.
      event.stopPropagation();
    });
    parent.append(this.element);
  }

  get isOpen(): boolean {
    return !this.form.hidden;
  }

  show(): void {
    this.element.hidden = false;
  }

  hide(): void {
    this.close();
    this.element.hidden = true;
  }

  open(): void {
    this.form.hidden = false;
    this.element.classList.add('is-open', 'is-active');
    window.clearTimeout(this.fadeTimer);
    this.updateCounter();
    this.input.focus({ preventScroll: true });
    this.log.scrollTop = this.log.scrollHeight;
  }

  close(): void {
    if (this.form.hidden) return;
    this.form.hidden = true;
    this.element.classList.remove('is-open');
    this.input.blur();
    this.scheduleFade();
    this.handlers.onClose();
  }

  clear(): void {
    this.log.replaceChildren();
  }

  addMessage(name: string, color: string, text: string): void {
    const nameNode = el('span', { class: 'chat-name', text: name });
    nameNode.style.color = color;
    this.append(
      el('li', { class: 'chat-line' }, [nameNode, el('span', { class: 'chat-text', text })]),
    );
  }

  addSystem(text: string): void {
    this.append(el('li', { class: 'chat-line chat-system', text }));
  }

  private append(line: HTMLElement): void {
    this.log.append(line);
    while (this.log.children.length > MAX_LINES) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
    this.element.classList.add('is-active');
    if (!this.isOpen) this.scheduleFade();
  }

  private scheduleFade(): void {
    window.clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(
      () => this.element.classList.remove('is-active'),
      FADE_AFTER_MS,
    );
  }

  private updateCounter(): void {
    const left = CHAT_MAX_LENGTH - this.input.value.length;
    this.counter.textContent = String(left);
    this.counter.classList.toggle('is-low', left <= 20);
  }
}
