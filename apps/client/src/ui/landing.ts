import { DEFAULT_ROOM, NAME_MAX_LENGTH, sanitizeName } from '@world/shared';
import { site } from '../content.ts';
import { checkPartyCode, partyFromAddress } from '../game/party.ts';
import { randomName } from '../util/names.ts';
import { storage } from '../util/storage.ts';
import { el } from './dom.ts';
import { svg } from './icons.ts';

const NAME_KEY = 'world.name';
const ROOM_HELP = 'Type a code to join friends, or make one up to start a party.';
const INVITED_HELP = 'You are invited to this party. Clear the code for the public lobby.';

export interface LandingHandlers {
  onEnter(name: string, room: string): void;
}

/** A circle of arrow going round clockwise, for rolling another name. */
function rerollIcon(): SVGSVGElement {
  return svg('0 0 16 16', [
    [
      'path',
      {
        d: 'M13 8A5 5 0 1 1 11.54 4.46',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.6',
        'stroke-linecap': 'round',
      },
    ],
    ['path', { d: 'M12.9 3.1V5.8H10.2Z', fill: 'currentColor' }],
  ]);
}

/**
 * The landing, centered over the kitchen going by: Daniel's name, what he studies, the cook's name
 * and the way in. A quiet row along the bottom has who is online, a private party (a code field that
 * opens under the name) and the plain portfolio.
 */
export class Landing {
  readonly element: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly roomInput: HTMLInputElement;
  private readonly roomHelp = el('p', {
    class: 'field-help',
    attrs: { id: 'landing-room-help', 'aria-live': 'polite' },
  });
  /** The party code field, shown only while the party is open. */
  private readonly party: HTMLElement;
  private readonly partyToggle: HTMLButtonElement;
  /** The party the address invited this visitor to, if any. */
  private readonly invitedTo: string | null;
  private readonly form: HTMLFormElement;
  private readonly enterButton: HTMLButtonElement;
  private readonly row: HTMLElement;
  /** The plain portfolio, in the quiet row. */
  private readonly portfolioLink = el('a', {
    class: 'landing-link',
    text: 'Plain portfolio',
    attrs: { href: '/portfolio.html' },
  });
  /** What Enter (the key) does when the landing shows: the way in, or the portfolio without WebGL. */
  private mainAction: HTMLElement;
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

    const reroll = el('button', {
      class: 'icon-button input-action landing-reroll',
      attrs: { type: 'button', 'aria-label': 'Pick a random name', title: 'Random name' },
    });
    reroll.append(rerollIcon());
    reroll.addEventListener('click', () => {
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

    this.party = el('div', { class: 'field landing-party', attrs: { id: 'landing-party' } }, [
      el('label', { class: 'field-label', text: 'Party code', attrs: { for: 'landing-room' } }),
      this.roomInput,
      this.roomHelp,
    ]);
    this.partyToggle = el('button', {
      class: 'landing-link',
      text: 'Private party',
      attrs: { type: 'button', 'aria-controls': 'landing-party' },
    });
    this.partyToggle.addEventListener('click', () => {
      const open = this.party.hidden !== false;
      this.setPartyOpen(open);
      if (open) this.roomInput.focus();
    });
    // An invite link opens the party with its code in.
    this.setPartyOpen(this.invitedTo !== null);

    this.enterButton = el('button', {
      class: 'button button-primary button-large',
      text: 'Enter the kitchen',
      attrs: { type: 'submit' },
    });
    this.mainAction = this.enterButton;

    this.form = el('form', { class: 'landing-form', attrs: { novalidate: '' } }, [
      el('div', { class: 'field' }, [
        el('label', { class: 'field-label', text: 'Your name', attrs: { for: 'landing-name' } }),
        el('div', { class: 'input-with-action' }, [this.nameInput, reroll]),
      ]),
      this.party,
      this.enterButton,
    ]);
    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
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

    this.row = el('div', { class: 'landing-row' }, [
      this.count,
      this.partyToggle,
      this.portfolioLink,
    ]);

    this.element = el(
      'section',
      { class: 'overlay landing', attrs: { 'aria-labelledby': 'landing-title', hidden: '' } },
      [
        el('div', { class: 'landing-main' }, [
          el('h1', {
            class: 'title landing-title',
            text: site.name,
            attrs: { id: 'landing-title' },
          }),
          el('span', { class: 'bar landing-bar', attrs: { 'aria-hidden': 'true' } }),
          el('p', { class: 'landing-headline', text: site.headline }),
          this.notice,
          this.form,
        ]),
        this.row,
      ],
    );
    parent.append(this.element);
  }

  private setPartyOpen(open: boolean): void {
    this.party.hidden = !open;
    this.partyToggle.setAttribute('aria-expanded', String(open));
  }

  /**
   * The room to enter: the lobby while the party is closed or its code is empty, null while the code
   * is not valid. A code left in a closed party stays for when it opens again, but does not count.
   */
  private chosenRoom(): string | null {
    if (this.party.hidden) return DEFAULT_ROOM;
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
    const party = room !== DEFAULT_ROOM;
    this.roomInput.value = party ? room : '';
    this.describeRoom();
    this.setPartyOpen(party);
  }

  show(): void {
    this.element.hidden = false;
    // Enter goes straight in; the ring round the way in waits for the keyboard to move.
    this.mainAction.focus({ preventScroll: true, focusVisible: false });
  }

  hide(): void {
    this.element.hidden = true;
  }

  /** Live player count in the public lobby; null while offline. */
  setCount(players: number | null): void {
    const text =
      players === null
        ? 'Server offline, play solo'
        : players === 0
          ? 'Nobody online yet'
          : `${players} online`;
    // Said again every few seconds; a screen reader hears it only when it changes.
    if (this.count.textContent !== text) this.count.textContent = text;
    this.count.classList.toggle('is-live', players !== null);
  }

  setNotice(message: string): void {
    this.notice.textContent = message;
    this.notice.hidden = message === '';
  }

  /**
   * A phone or tablet: the world wants a keyboard and mouse, so the portfolio becomes the way in,
   * and the kitchen a quiet second choice for a tablet with a keyboard.
   */
  suggestPortfolio(message: string): void {
    this.setNotice(message);
    const portfolio = el('a', {
      class: 'button button-primary button-large landing-portfolio',
      text: 'View the portfolio',
      attrs: { href: '/portfolio.html' },
    });
    this.form.before(portfolio);
    this.enterButton.classList.remove('button-primary', 'button-large');
    this.portfolioLink.hidden = true;
    this.mainAction = portfolio;
  }

  /**
   * The world cannot run (no WebGL, or it failed to load), so the portfolio becomes the way in: the
   * one a phone was already offered, or a new one.
   */
  setUnsupported(message: string): void {
    this.setNotice(message);
    this.form.hidden = true;
    this.row.hidden = true;
    if (this.mainAction !== this.enterButton) return;
    const portfolio = el('a', {
      class: 'button button-primary button-large landing-portfolio',
      text: 'View the portfolio',
      attrs: { href: '/portfolio.html' },
    });
    this.form.after(portfolio);
    this.mainAction = portfolio;
  }
}
