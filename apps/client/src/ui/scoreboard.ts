import type { GameStateMessage } from '@world/shared';
import { el } from './dom.ts';

const RESULTS_MS = 10_000;
const SHOWN_ROWS = 6;

export interface ScoreboardPlayer {
  name: string;
  color: string;
}

function formatTime(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Tag round overlay: timer, who is it, and the ranking. */
export class Scoreboard {
  readonly element: HTMLElement;
  private readonly title = el('span', { class: 'scoreboard-title', text: 'Tag' });
  private readonly timer = el('span', { class: 'scoreboard-timer' });
  private readonly banner = el('p', { class: 'scoreboard-banner' });
  private readonly list = el('ol', { class: 'scoreboard-list' });
  private endsAt = 0;
  private tickTimer = 0;
  private hideTimer = 0;

  constructor(parent: HTMLElement) {
    this.element = el(
      'section',
      { class: 'scoreboard', attrs: { 'aria-label': 'Tag scoreboard', hidden: '' } },
      [
        el('header', { class: 'scoreboard-head' }, [this.title, this.timer]),
        this.banner,
        this.list,
      ],
    );
    parent.append(this.element);
  }

  get isVisible(): boolean {
    return !this.element.hidden;
  }

  update(
    state: GameStateMessage,
    selfId: number | null,
    lookup: (id: number) => ScoreboardPlayer | null,
  ): void {
    window.clearTimeout(this.hideTimer);
    this.element.hidden = false;
    const playing = state.phase === 'playing';
    this.element.classList.toggle('is-ended', !playing);
    this.element.classList.toggle('is-you-it', playing && state.it === selfId);

    if (playing) {
      const it = state.it === null ? null : lookup(state.it);
      this.banner.textContent =
        state.it === selfId ? "You're it! Tag someone." : it ? `${it.name} is it. Run!` : '';
      this.endsAt = performance.now() + state.remainingMs;
      this.renderTimer();
      window.clearInterval(this.tickTimer);
      this.tickTimer = window.setInterval(() => this.renderTimer(), 250);
    } else {
      window.clearInterval(this.tickTimer);
      const winner = state.scores[0] ? lookup(state.scores[0].id) : null;
      this.timer.textContent = 'Final';
      this.banner.textContent = winner
        ? `${state.scores[0]!.id === selfId ? 'You win' : `${winner.name} wins`}!`
        : 'Round over';
      this.hideTimer = window.setTimeout(() => this.hide(), RESULTS_MS);
    }

    const rows = state.scores.slice(0, SHOWN_ROWS);
    // Always show yourself, even when outside the top rows.
    const own = state.scores.findIndex((s) => s.id === selfId);
    if (own >= SHOWN_ROWS) rows.push(state.scores[own]!);
    this.list.replaceChildren(
      ...rows.map((row) => {
        const player = lookup(row.id);
        const rank = state.scores.indexOf(row) + 1;
        const item = el('li', { class: 'scoreboard-row' }, [
          el('span', { class: 'scoreboard-rank', text: String(rank) }),
          el('span', { class: 'scoreboard-dot' }),
          el('span', { class: 'scoreboard-name', text: player?.name ?? 'Someone' }),
          playing && row.id === state.it
            ? el('span', { class: 'scoreboard-it', text: 'IT' })
            : null,
          el('span', { class: 'scoreboard-score', text: String(row.score) }),
        ]);
        item.style.setProperty('--player-color', player?.color ?? '#ffffff');
        item.classList.toggle('is-self', row.id === selfId);
        return item;
      }),
    );
  }

  hide(): void {
    window.clearInterval(this.tickTimer);
    window.clearTimeout(this.hideTimer);
    this.element.hidden = true;
  }

  private renderTimer(): void {
    this.timer.textContent = formatTime(Math.max(0, this.endsAt - performance.now()));
  }
}
