import { MAX_PLAYERS_PER_ROOM, DEFAULT_ROOM } from '@world/shared';
import type { ConnectionStatus } from '../net/connection.ts';
import { el } from './dom.ts';

export interface HudPlayer {
  id: number;
  name: string;
  color: string;
  isSelf: boolean;
}

/** Always-on in-world overlay: crosshair, prompt, room and connection, player list, controls hint. */
export class Hud {
  readonly element: HTMLElement;
  private readonly crosshair = el('div', { class: 'crosshair' });
  private readonly prompt = el('div', { class: 'prompt', attrs: { 'aria-live': 'polite' } });
  /** While the mouse is free in play: how to get it back for looking around. */
  private readonly lookCue = el('div', { class: 'look-cue', text: 'Click to look around' });
  private lookCueShown = false;
  private readonly roomLabel = el('span', { class: 'hud-label', text: 'Room' });
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
  private readonly playerCount = el('span', { class: 'hud-players-count' });
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
  /** The bottom right corner, where the loadout stacks over the minimap. */
  readonly corner = el('div', { class: 'hud-corner' });
  /** Under the player list, top right: where the kill feed goes. */
  readonly feedSlot = el('div', { class: 'hud-feed' });
  private hintTimer = 0;
  private promptText = '';
  private playersKey = '';

  constructor(parent: HTMLElement) {
    this.element = el('div', { class: 'hud', attrs: { hidden: '' } }, [
      this.crosshair,
      this.prompt,
      this.lookCue,
      el('div', { class: 'hud-panel hud-room' }, [
        this.roomLabel,
        this.roomName,
        this.status,
        this.fps,
        this.statusAnnouncement,
      ]),
      el('div', { class: 'hud-right' }, [
        el(
          'section',
          { class: 'hud-panel hud-players', attrs: { 'aria-label': 'Players in this room' } },
          [
            el('div', { class: 'hud-players-head' }, [
              el('span', { class: 'hud-label', text: 'Players' }),
              this.playerCount,
            ]),
            this.playerList,
          ],
        ),
        this.feedSlot,
      ]),
      this.hint,
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

  setRoom(code: string): void {
    const party = code !== DEFAULT_ROOM;
    this.roomLabel.textContent = party ? 'Party' : 'Room';
    this.roomName.textContent = party ? `#${code}` : 'lobby';
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

  setPlayers(players: readonly HudPlayer[]): void {
    const key = players.map((p) => `${p.id}:${p.name}:${p.color}:${p.isSelf}`).join('|');
    if (key === this.playersKey) return;
    this.playersKey = key;
    this.playerCount.textContent = `${players.length} / ${MAX_PLAYERS_PER_ROOM}`;
    this.playerList.replaceChildren(
      ...players.map((p) => {
        const item = el('li', { class: 'hud-player' }, [
          el('span', { class: 'hud-player-dot' }),
          el('span', { class: 'hud-player-name', text: p.name }),
          p.isSelf ? el('span', { class: 'hud-player-you', text: 'you' }) : null,
        ]);
        item.style.setProperty('--player-color', p.color);
        return item;
      }),
    );
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
