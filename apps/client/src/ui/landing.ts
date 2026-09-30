import {
  DEFAULT_ROOM,
  NAME_MAX_LENGTH,
  ROOM_CODE_MAX_LENGTH,
  normalizeRoomCode,
  sanitizeName,
} from '@world/shared';
import { site } from '../content.ts';
import { randomName } from '../util/names.ts';
import { storage } from '../util/storage.ts';
import { el } from './dom.ts';

const NAME_KEY = 'world.name';

export interface LandingHandlers {
  onEnter(name: string, room: string): void;
}

/** Title card over the slowly orbiting island. */
export class Landing {
  readonly element: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly roomInput: HTMLInputElement;
  private readonly enterButton: HTMLButtonElement;
  private readonly count = el('p', { class: 'landing-count', attrs: { 'aria-live': 'polite' } });
  private readonly notice = el('p', {
    class: 'landing-notice',
    attrs: { role: 'note', hidden: '' },
  });

  constructor(parent: HTMLElement, handlers: LandingHandlers) {
    this.nameInput = el('input', {
      class: 'input',
      attrs: {
        id: 'landing-name',
        name: 'name',
        type: 'text',
        autocomplete: 'nickname',
        maxlength: String(NAME_MAX_LENGTH),
        spellcheck: 'false',
        required: '',
      },
    });
    this.nameInput.value = sanitizeName(storage.get(NAME_KEY) ?? '') || randomName();

    const shuffle = el('button', {
      class: 'icon-button input-action',
      text: '⟳',
      attrs: { type: 'button', 'aria-label': 'Pick a random name', title: 'Random name' },
    });
    shuffle.addEventListener('click', () => {
      this.nameInput.value = randomName();
      this.nameInput.focus();
    });

    this.roomInput = el('input', {
      class: 'input',
      attrs: {
        id: 'landing-room',
        name: 'room',
        type: 'text',
        placeholder: `${DEFAULT_ROOM} (public)`,
        autocomplete: 'off',
        spellcheck: 'false',
        maxlength: String(ROOM_CODE_MAX_LENGTH),
      },
    });
    const roomParam = new URLSearchParams(location.search).get('room');
    if (roomParam) this.roomInput.value = normalizeRoomCode(roomParam);

    this.enterButton = el('button', {
      class: 'button button-primary button-large',
      text: 'Enter world',
      attrs: { type: 'submit' },
    });

    const form = el('form', { class: 'landing-form', attrs: { novalidate: '' } }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: 'Your name', attrs: { for: 'landing-name' } }),
        el('div', { class: 'input-with-action' }, [this.nameInput, shuffle]),
      ]),
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: 'Room code', attrs: { for: 'landing-room' } }),
        this.roomInput,
        el('p', { class: 'field-help', text: 'Leave empty to join everyone in the lobby.' }),
      ]),
      this.enterButton,
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.enterButton.disabled) return;
      const name = sanitizeName(this.nameInput.value) || randomName();
      this.nameInput.value = name;
      storage.set(NAME_KEY, name);
      handlers.onEnter(name, normalizeRoomCode(this.roomInput.value));
    });

    this.element = el(
      'section',
      { class: 'overlay landing', attrs: { 'aria-labelledby': 'landing-title', hidden: '' } },
      [
        el('div', { class: 'card landing-card' }, [
          el('p', { class: 'landing-eyebrow', text: site.worldName }),
          el('h1', { class: 'landing-title', text: site.name, attrs: { id: 'landing-title' } }),
          el('p', { class: 'landing-tagline', text: site.tagline }),
          this.notice,
          form,
          el('div', { class: 'landing-footer' }, [
            this.count,
            el('a', {
              class: 'text-link',
              text: 'Skip to portfolio →',
              attrs: { href: '/portfolio.html' },
            }),
          ]),
        ]),
        el('p', {
          class: 'landing-controls',
          text: 'WASD to move · Mouse to look · Click glowing objects',
        }),
      ],
    );
    parent.append(this.element);
    this.count.textContent = 'Checking who is here…';
  }

  show(): void {
    this.element.hidden = false;
    this.enterButton.focus({ preventScroll: true });
  }

  hide(): void {
    this.element.hidden = true;
  }

  /** Live player count in the public lobby; null while unknown or offline. */
  setCount(players: number | null): void {
    this.count.classList.toggle('is-live', players !== null);
    if (players === null) {
      this.count.textContent = 'Server offline: you can still explore solo';
    } else if (players === 0) {
      this.count.textContent = 'The lobby is empty. Be the first!';
    } else {
      this.count.textContent = `${players} ${players === 1 ? 'explorer' : 'explorers'} in the lobby`;
    }
  }

  setNotice(message: string): void {
    this.notice.textContent = message;
    this.notice.hidden = message === '';
  }

  /** No WebGL: the world cannot run, so the portfolio becomes the main action. */
  setUnsupported(message: string): void {
    this.setNotice(message);
    this.enterButton.disabled = true;
    this.enterButton.textContent = '3D world unavailable';
    const portfolio = el('a', {
      class: 'button button-primary button-large',
      text: 'View the portfolio',
      attrs: { href: '/portfolio.html' },
    });
    this.enterButton.after(portfolio);
  }
}
