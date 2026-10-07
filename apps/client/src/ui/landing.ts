import { DEFAULT_ROOM, NAME_MAX_LENGTH, sanitizeName } from '@world/shared';
import { site } from '../content.ts';
import { checkPartyCode, partyFromAddress } from '../game/party.ts';
import { randomName } from '../util/names.ts';
import { storage } from '../util/storage.ts';
import { el } from './dom.ts';

const NAME_KEY = 'world.name';
const ROOM_HELP = 'Type a code to join friends, or make one up to start a party.';
const INVITED_HELP = 'You are invited to this party. Clear the code for the public lobby.';

export interface LandingHandlers {
  onEnter(name: string, room: string): void;
}

/** Title card over the slowly drifting view of the kitchen. */
export class Landing {
  readonly element: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly roomInput: HTMLInputElement;
  private readonly roomHelp = el('p', {
    class: 'field-help',
    attrs: { id: 'landing-room-help', 'aria-live': 'polite' },
  });
  /** The party the address invited this visitor to, if any. */
  private readonly invitedTo: string | null;
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
        placeholder: 'Leave empty for the public lobby',
        autocomplete: 'off',
        spellcheck: 'false',
        // Room for a too-long code to be pasted and called too long, not cut off without a word.
        maxlength: '64',
        'aria-describedby': 'landing-room-help',
      },
    });
    this.invitedTo = partyFromAddress(location.search);
    this.roomInput.value = this.invitedTo ?? '';
    this.roomInput.addEventListener('input', () => this.describeRoom());
    this.describeRoom();

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
        el('label', {
          class: 'field-label',
          text: 'Private party',
          attrs: { for: 'landing-room' },
        }),
        this.roomInput,
        this.roomHelp,
      ]),
      this.enterButton,
    ]);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      if (this.enterButton.disabled) return;
      const room = this.chosenRoom();
      if (room === null) {
        this.roomInput.focus();
        return;
      }
      const name = sanitizeName(this.nameInput.value) || randomName();
      this.nameInput.value = name;
      storage.set(NAME_KEY, name);
      handlers.onEnter(name, room);
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
          text: 'WASD to move · Mouse to look · E to open a station',
        }),
      ],
    );
    parent.append(this.element);
    this.count.textContent = 'Checking who is here…';
  }

  /** The room to enter: the lobby when the field is empty, null while the code is not valid. */
  private chosenRoom(): string | null {
    const check = checkPartyCode(this.roomInput.value);
    if (check.ok) return check.code;
    return check.problem === 'empty' || check.problem === 'lobby' ? DEFAULT_ROOM : null;
  }

  /** The line under the party code: what the field does, the invitation, or what is wrong. */
  private describeRoom(): void {
    const value = this.roomInput.value;
    const check = checkPartyCode(value);
    const invalid = !check.ok && (check.problem === 'characters' || check.problem === 'too_long');
    this.roomHelp.textContent = invalid
      ? check.message
      : this.invitedTo !== null && check.ok && check.code === this.invitedTo
        ? INVITED_HELP
        : ROOM_HELP;
    this.roomHelp.dataset.tone = invalid ? 'error' : 'help';
    this.roomInput.setAttribute('aria-invalid', String(invalid));
  }

  /** Show the room the player was last in, so entering again goes back there. */
  setRoom(room: string): void {
    this.roomInput.value = room === DEFAULT_ROOM ? '' : room;
    this.describeRoom();
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
      this.count.textContent = `${players} ${players === 1 ? 'cook' : 'cooks'} in the kitchen`;
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
