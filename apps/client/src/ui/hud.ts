import { MAX_PLAYERS_PER_ROOM, DEFAULT_ROOM } from '@world/shared';
import type { ConnectionStatus } from '../net/connection.ts';
import { el } from './dom.ts';

export interface HudPlayer {
  id: number;
  name: string;
  color: string;
  isSelf: boolean;
}

/**
 * The most names the list shows. Past this, the last row counts the rest, so a full room does not
 * run the list down into the kill feed and the loadout.
 */
export const MAX_PLAYER_ROWS = 8;

/** How many names to list for a room of `total`, the rest folded into one "and N more" row. */
export function listedPlayers(total: number): number {
  return total <= MAX_PLAYER_ROWS ? total : MAX_PLAYER_ROWS - 1;
}

/** The prompt read out in full: "Open Products" becomes "Press E to open Products". */
export function promptSentence(action: string): string {
  return `Press E to ${action.charAt(0).toLowerCase()}${action.slice(1)}`;
}

/** Always-on in-world overlay: crosshair, prompt, room and connection, player list, controls hint. */
export class Hud {
  readonly element: HTMLElement;
  private readonly crosshair = el('div', { class: 'crosshair' });
  /** The prompt in full, for screen readers (and tests); on screen it is the E ring and the action. */
  private readonly promptText = el('span', { class: 'prompt-sentence visually-hidden' });
  private readonly promptAction = el('span', { class: 'prompt-action' });
  private readonly prompt = el('div', { class: 'prompt', attrs: { 'aria-live': 'polite' } }, [
    this.promptText,
    el('span', { class: 'prompt-cue', attrs: { 'aria-hidden': 'true' } }, [
      el('kbd', { text: 'E' }),
      this.promptAction,
    ]),
  ]);
  /** While the mouse is free in play: how to get it back for looking around. */
  private readonly lookCue = el('div', { class: 'look-cue', text: 'Click to look around' });
  private lookCueShown = false;
  /** "Party" before a party's code; the lobby's name says what it is. */
  private readonly roomKind = el('span', { class: 'hud-room-kind', text: 'Party ' });
  private readonly roomName = el('span', { class: 'hud-room-name' });
  private readonly statusDot = el(
    'span',
    { class: 'status-signal', attrs: { 'aria-hidden': 'true' } },
    [el('i'), el('i'), el('i')],
  );
  private readonly statusText = el('span', { class: 'hud-status-text' });
  private readonly status = el('div', { class: 'hud-status' }, [this.statusDot, this.statusText]);
  /** Screen readers hear only status changes, not the ping or countdown ticking. */
  private readonly statusAnnouncement = el('span', {
    class: 'visually-hidden',
    attrs: { role: 'status' },
  });
  private readonly playerCount = el('p', { class: 'hud-players-count' });
  private readonly fps = el('span', { class: 'hud-fps', attrs: { hidden: '' } });
  private readonly playerList = el('ul', { class: 'hud-players-list' });
  private readonly hint = el('div', { class: 'hint' }, [
    el('kbd', { text: 'WASD' }),
    ' move ',
    el('kbd', { text: 'Space' }),
    ' jump ',
    el('kbd', { text: 'Shift' }),
    ' sprint ',
    el('kbd', { text: 'Q' }),
    ' switch ',
    el('kbd', { text: 'I' }),
    ' inspect',
  ]);
  /** How to play DOOM, and how to stop, while at the kitchen computer. */
  private readonly computerHint = el('div', { class: 'hint computer-hint' }, [
    el('kbd', { text: 'Mouse' }),
    ' turn ',
    el('kbd', { text: 'Click' }),
    ' fire ',
    el('kbd', { text: 'E' }),
    ' open ',
    el('kbd', { text: 'WASD' }),
    ' move ',
    el('kbd', { text: 'Shift' }),
    ' run ',
    el('kbd', { text: 'Tab' }),
    ' map ',
    el('kbd', { text: '`' }),
    ' menu ',
    el('kbd', { text: 'Esc' }),
    ' step away',
  ]);
  /** The bottom right corner, where the loadout stacks over the minimap. */
  readonly corner = el('div', { class: 'hud-corner' });
  /** Under the player list, top right: where the kill feed goes. */
  readonly feedSlot = el('div', { class: 'hud-feed' });
  private hintTimer = 0;
  private promptShown = '';
  private playersKey = '';

  constructor(parent: HTMLElement) {
    this.element = el('div', { class: 'hud', attrs: { hidden: '' } }, [
      this.crosshair,
      this.prompt,
      this.lookCue,
      el('div', { class: 'hud-room' }, [
        el('p', { class: 'hud-room-title' }, [this.roomKind, this.roomName]),
        el('div', { class: 'hud-room-line' }, [this.status, this.fps]),
        this.statusAnnouncement,
      ]),
      el('div', { class: 'hud-right' }, [
        el('section', { class: 'hud-players', attrs: { 'aria-label': 'Players in this room' } }, [
          this.playerCount,
          this.playerList,
        ]),
        this.feedSlot,
      ]),
      this.hint,
      this.computerHint,
      this.corner,
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

  /** While a panel or menu covers the world, hide the parts that would peek out or mislead. */
  setCovered(covered: boolean): void {
    this.element.classList.toggle('is-covered', covered);
  }

  /**
   * At the kitchen computer only the room, the players and how to play DOOM show: the full guide
   * over the screen at first, then a one-line reminder along the bottom.
   */
  setComputer(state: 'off' | 'guide' | 'playing'): void {
    this.element.classList.toggle('is-computer', state !== 'off');
    this.element.classList.toggle('is-computer-guide', state === 'guide');
  }

  setRoom(code: string): void {
    const party = code !== DEFAULT_ROOM;
    this.roomKind.hidden = !party;
    this.roomName.textContent = party ? `#${code}` : 'The lobby';
  }

  /**
   * Connection, in a player's words: online with signal bars (the round trip is in the tooltip),
   * connecting, or solo. Retries happen quietly in the background; no countdown ticks here.
   */
  setStatus(
    status: ConnectionStatus,
    options: { rtt?: number | null; updating?: boolean } = {},
  ): void {
    if (this.status.dataset.status !== status) {
      this.statusAnnouncement.textContent =
        status === 'online'
          ? 'Connected'
          : status === 'connecting'
            ? 'Connecting'
            : 'Offline, playing solo';
    }
    this.status.dataset.status = status;
    const rtt = options.rtt ?? null;
    this.status.dataset.signal =
      status !== 'online' ? '0' : rtt === null || rtt < 90 ? '3' : rtt < 180 ? '2' : '1';
    this.status.title =
      status === 'online' && rtt !== null ? `${Math.round(rtt)} ms round trip` : '';
    this.statusText.textContent =
      status === 'online'
        ? 'Online'
        : status === 'connecting'
          ? 'Connecting'
          : options.updating
            ? 'Solo · updating'
            : 'Solo';
  }

  /** The frame rate readout: a number to show, or null to hide it. */
  setFps(fps: number | null): void {
    this.fps.hidden = fps === null;
    if (fps !== null) this.fps.textContent = fps > 0 ? `${fps} fps` : '';
  }

  setLookCue(shown: boolean): void {
    if (shown === this.lookCueShown) return;
    this.lookCueShown = shown;
    this.lookCue.classList.toggle('is-visible', shown);
  }

  /** The room's cooks, yours first (marked "you"), each by a dot of their color. */
  setPlayers(players: readonly HudPlayer[]): void {
    const key = players.map((p) => `${p.id}:${p.name}:${p.color}:${p.isSelf}`).join('|');
    if (key === this.playersKey) return;
    this.playersKey = key;
    this.playerCount.textContent = `${players.length} / ${MAX_PLAYERS_PER_ROOM}`;
    const listed = listedPlayers(players.length);
    const rows: HTMLElement[] = players.slice(0, listed).map((p) => {
      const item = el('li', { class: `hud-player${p.isSelf ? ' is-self' : ''}` }, [
        el('span', { class: 'hud-player-name', text: p.name }),
        // After the name, so a screen reader hears the name first; the styles put it in front.
        p.isSelf ? el('span', { class: 'hud-player-you', text: 'you' }) : null,
        el('span', { class: 'hud-player-dot' }),
      ]);
      item.style.setProperty('--player-color', p.color);
      return item;
    });
    if (listed < players.length) {
      rows.push(
        el('li', {
          class: 'hud-player hud-player-more',
          text: `and ${players.length - listed} more`,
        }),
      );
    }
    this.playerList.replaceChildren(...rows);
  }

  /**
   * What E does at the object under the crosshair, as a verb phrase in sentence case ("Open
   * Products", "Play DOOM"), or null to clear it.
   */
  setPrompt(action: string | null): void {
    const next = action ?? '';
    if (next === this.promptShown) return;
    this.promptShown = next;
    this.promptText.textContent = next && promptSentence(next);
    this.promptAction.textContent = next;
    this.prompt.classList.toggle('is-visible', next !== '');
    this.crosshair.classList.toggle('is-active', next !== '');
  }
}
