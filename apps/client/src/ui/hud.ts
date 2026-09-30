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
  private readonly roomName = el('span', { class: 'hud-room-name' });
  private readonly statusDot = el('span', { class: 'status-dot' });
  private readonly statusText = el('span', { class: 'hud-status-text' });
  private readonly status = el('div', { class: 'hud-status', attrs: { role: 'status' } }, [
    this.statusDot,
    this.statusText,
  ]);
  private readonly playerCount = el('span', { class: 'hud-players-count' });
  private readonly playerList = el('ul', { class: 'hud-players-list' });
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
  private playersKey = '';

  constructor(parent: HTMLElement) {
    this.element = el('div', { class: 'hud', attrs: { hidden: '' } }, [
      this.crosshair,
      this.prompt,
      el('div', { class: 'hud-panel hud-room' }, [
        el('span', { class: 'hud-label', text: 'Room' }),
        this.roomName,
        this.status,
      ]),
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

  setRoom(code: string): void {
    this.roomName.textContent = code === DEFAULT_ROOM ? 'lobby' : `#${code}`;
  }

  setStatus(status: ConnectionStatus, detail: string): void {
    this.status.dataset.status = status;
    this.statusText.textContent = detail;
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
