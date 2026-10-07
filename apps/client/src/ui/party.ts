import { DEFAULT_ROOM, MAX_PLAYERS_PER_ROOM, type RoomIntent } from '@world/shared';
import { checkPartyCode, randomPartyCode } from '../game/party.ts';
import { el } from './dom.ts';

/** Whether parties can be started or joined right now, as the connection allows. */
export type PartyAvailability = 'online' | 'connecting' | 'offline' | 'updating';

export interface PartyHandlers {
  /** Move into `room`. Resolves to null once there, or to why not, in the visitor's words. */
  onMove(room: string, intent?: RoomIntent): Promise<string | null>;
}

const UNAVAILABLE: Record<Exclude<PartyAvailability, 'online'>, string> = {
  connecting: 'Connecting to the server. Parties open up once you are online.',
  offline:
    'The server is unreachable, so parties are unavailable for now. Keep cooking solo; this updates once it is back.',
  updating:
    'Multiplayer is on a different version of the site right now, so parties are unavailable. Reload the page if this lasts.',
};

const CODE_HELP = 'Letters, numbers and dashes. Make one up, or roll a random one.';
const INVITE_HELP = `Anyone with the code or this link can come in, up to ${MAX_PLAYERS_PER_ROOM} cooks.`;
const COPIED_MS = 2500;

type Tone = 'help' | 'error' | 'warn' | 'ok';

function setLine(line: HTMLElement, text: string, tone: Tone): void {
  line.textContent = text;
  line.dataset.tone = tone;
}

function isMac(): boolean {
  return /Mac|iPhone|iPad/.test(navigator.userAgent);
}

/**
 * The pause menu's Party tab: where you are (and, in a party, the link that brings friends), then
 * a code to start or join a party with. Moving happens in place; while it is under way, or while
 * the server cannot be reached, the buttons say no and the line under the code says why.
 * Buttons are marked `aria-disabled` rather than disabled, so focus never drops out of the menu.
 */
export class PartyPanel {
  readonly element: HTMLElement;
  private room = DEFAULT_ROOM;
  private availability: PartyAvailability = 'connecting';
  /** What the last move is doing or why it failed; cleared as soon as the code changes. */
  private outcome: { text: string; tone: Tone } | null = null;
  private busy = false;
  private copyTimer = 0;
  private readonly handlers: PartyHandlers;

  private readonly where = el('p', { class: 'party-where' });
  private readonly whereHelp = el('p', { class: 'party-line' });
  private readonly lobbyButton = el('button', {
    class: 'button button-secondary button-small',
    text: 'Back to the lobby',
    attrs: { type: 'button' },
  });
  private readonly invite = el('div', { class: 'party-invite' });
  private readonly inviteInput = el('input', {
    class: 'input party-link',
    attrs: {
      id: 'party-invite',
      type: 'text',
      readonly: '',
      spellcheck: 'false',
      'aria-label': 'Invite link',
      'aria-describedby': 'party-invite-status',
    },
  });
  private readonly copyButton = el('button', {
    class: 'button button-secondary party-copy',
    text: 'Copy link',
    attrs: { type: 'button' },
  });
  private readonly copyStatus = el('p', {
    class: 'party-line',
    attrs: { id: 'party-invite-status', 'aria-live': 'polite' },
  });
  private readonly codeInput = el('input', {
    class: 'input',
    attrs: {
      id: 'party-code',
      name: 'party-code',
      type: 'text',
      autocomplete: 'off',
      spellcheck: 'false',
      // Room for a too-long code to be pasted and called too long, not cut off without a word.
      maxlength: '64',
      placeholder: 'e.g. friday-service',
      'aria-describedby': 'party-code-status',
    },
  });
  private readonly codeStatus = el('p', {
    class: 'party-line',
    attrs: { id: 'party-code-status', 'aria-live': 'polite' },
  });
  private readonly randomButton = el('button', {
    class: 'icon-button input-action',
    text: '⟳',
    attrs: { type: 'button', 'aria-label': 'Roll a random code', title: 'Random code' },
  });
  private readonly startButton = el('button', {
    class: 'button button-primary',
    text: 'Start party',
    attrs: { type: 'submit' },
  });
  private readonly joinButton = el('button', {
    class: 'button button-secondary',
    text: 'Join party',
    attrs: { type: 'button' },
  });

  constructor(handlers: PartyHandlers) {
    this.handlers = handlers;
    const form = el(
      'form',
      {
        class: 'party-section party-form',
        attrs: { novalidate: '', 'aria-labelledby': 'party-form-heading' },
      },
      [
        el('h3', {
          class: 'party-heading',
          text: 'Start or join a party',
          attrs: { id: 'party-form-heading' },
        }),
        el('div', { class: 'field' }, [
          el('label', { class: 'field-label', text: 'Party code', attrs: { for: 'party-code' } }),
          el('div', { class: 'input-with-action' }, [this.codeInput, this.randomButton]),
          this.codeStatus,
        ]),
        el('div', { class: 'party-actions' }, [this.startButton, this.joinButton]),
      ],
    );
    this.invite.append(
      el('div', { class: 'party-invite-row' }, [this.inviteInput, this.copyButton]),
      this.copyStatus,
    );
    this.element = el('div', { class: 'pause-panel party' }, [
      el(
        'section',
        { class: 'party-section', attrs: { 'aria-labelledby': 'party-where-heading' } },
        [
          el('h3', {
            class: 'party-heading',
            text: 'Now cooking in',
            attrs: { id: 'party-where-heading' },
          }),
          el('div', { class: 'party-where-row' }, [this.where, this.lobbyButton]),
          this.whereHelp,
          this.invite,
        ],
      ),
      form,
    ]);

    form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submit('start');
    });
    this.joinButton.addEventListener('click', () => this.submit('join'));
    this.lobbyButton.addEventListener('click', () => {
      if (!this.busy) void this.move(DEFAULT_ROOM, undefined, 'Heading back to the lobby…');
    });
    this.randomButton.addEventListener('click', () => {
      if (this.busy) return;
      this.codeInput.value = randomPartyCode();
      this.outcome = null;
      this.refresh();
      this.codeInput.focus();
    });
    this.codeInput.addEventListener('input', () => {
      this.outcome = null;
      this.refresh();
    });
    this.copyButton.addEventListener('click', () => void this.copy());
    // One click selects the whole link, ready to copy by hand.
    this.inviteInput.addEventListener('focus', () => this.inviteInput.select());
    this.setRoom(DEFAULT_ROOM, null);
  }

  /** The room the player is in now, and its invite link (null for the lobby). */
  setRoom(room: string, link: string | null): void {
    this.room = room;
    const inParty = link !== null;
    this.where.textContent = inParty ? `#${room}` : 'The public lobby';
    this.whereHelp.hidden = inParty;
    setLine(
      this.whereHelp,
      'Everyone who visits lands here, and Chef Skinner works the line.',
      'help',
    );
    this.lobbyButton.hidden = !inParty;
    this.invite.hidden = !inParty;
    this.inviteInput.value = link ?? '';
    this.resetCopy();
    this.codeInput.value = '';
    this.outcome = null;
    this.refresh();
  }

  setAvailability(availability: PartyAvailability): void {
    // A retry does not make the server any more reachable: keep saying why until it answers.
    const unreachable = this.availability === 'offline' || this.availability === 'updating';
    if (availability === 'connecting' && unreachable) return;
    if (availability === this.availability) return;
    this.availability = availability;
    this.refresh();
  }

  /** Start or join with the typed code, or say what is wrong with it. */
  private submit(intent: RoomIntent): void {
    if (this.busy) return;
    if (this.availability !== 'online') {
      this.refresh();
      return;
    }
    const check = checkPartyCode(this.codeInput.value);
    if (!check.ok) {
      this.outcome = { text: check.message, tone: 'error' };
      this.refresh();
      this.codeInput.focus();
      return;
    }
    if (check.code === this.room) {
      this.outcome = { text: `You are already in #${check.code}.`, tone: 'error' };
      this.refresh();
      return;
    }
    const doing = intent === 'start' ? 'Starting' : 'Joining';
    void this.move(check.code, intent, `${doing} #${check.code}…`);
  }

  private async move(room: string, intent: RoomIntent | undefined, doing: string): Promise<void> {
    this.busy = true;
    this.outcome = { text: doing, tone: 'help' };
    this.refresh();
    const failure = await this.handlers.onMove(room, intent);
    this.busy = false;
    if (failure === null) {
      // `setRoom` has shown the new room; carry on from what comes next there.
      if (this.room === DEFAULT_ROOM) this.codeInput.focus();
      else this.copyButton.focus();
      this.refresh();
      return;
    }
    this.outcome = { text: failure, tone: 'error' };
    this.refresh();
  }

  /** Bring the buttons and the line under the code up to date with everything above. */
  private refresh(): void {
    const canMove = !this.busy && this.availability === 'online';
    this.startButton.setAttribute('aria-disabled', String(!canMove));
    this.joinButton.setAttribute('aria-disabled', String(!canMove));
    this.randomButton.setAttribute('aria-disabled', String(this.busy));
    this.lobbyButton.setAttribute('aria-disabled', String(this.busy));

    const typed = this.codeInput.value;
    const check = checkPartyCode(typed);
    // Only a code being typed is judged as it changes; an empty field is not a mistake yet.
    const invalid = !check.ok && check.problem !== 'empty';
    let text = CODE_HELP;
    let tone: Tone = 'help';
    if (this.outcome) {
      ({ text, tone } = this.outcome);
    } else if (invalid) {
      text = check.message;
      tone = 'error';
    } else if (this.availability !== 'online') {
      text = UNAVAILABLE[this.availability];
      tone = 'warn';
    } else if (check.ok && check.code !== typed.trim()) {
      text = `Shared as #${check.code}.`;
    }
    setLine(this.codeStatus, text, tone);
    this.codeInput.setAttribute('aria-invalid', String(invalid || this.outcome?.tone === 'error'));
  }

  /** Copy the invite link; where the browser will not allow it, select it for copying by hand. */
  private async copy(): Promise<void> {
    const link = this.inviteInput.value;
    try {
      await navigator.clipboard.writeText(link);
      this.copyButton.textContent = 'Copied';
      setLine(this.copyStatus, 'Link copied. Send it to your friends.', 'ok');
      window.clearTimeout(this.copyTimer);
      this.copyTimer = window.setTimeout(() => this.resetCopy(), COPIED_MS);
    } catch {
      // No clipboard (an insecure page) or no permission: hand the link over selected instead.
      window.clearTimeout(this.copyTimer);
      this.copyButton.textContent = 'Copy link';
      this.inviteInput.focus();
      this.inviteInput.select();
      setLine(
        this.copyStatus,
        `Copying was blocked, so the link is selected: press ${isMac() ? '⌘C' : 'Ctrl+C'} to copy it.`,
        'warn',
      );
    }
  }

  private resetCopy(): void {
    window.clearTimeout(this.copyTimer);
    this.copyButton.textContent = 'Copy link';
    setLine(this.copyStatus, INVITE_HELP, 'help');
  }
}
