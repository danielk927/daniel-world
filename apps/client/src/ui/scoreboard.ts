import { el } from './dom.ts';

/** One cook's line of the scoreboard. */
export interface ScoreRow {
  readonly id: number;
  readonly name: string;
  readonly color: string;
  readonly kills: number;
  readonly deaths: number;
  readonly assists: number;
  /** This player, who is marked as "you". */
  readonly isSelf: boolean;
}

/**
 * The rows in the order the scoreboard shows them: most kills first, then fewest deaths, then most
 * assists, and cooks who tie in all three in the order they came into the room (the lower id
 * first), so a line never jumps about between two with the same score.
 */
export function rankRows(rows: readonly ScoreRow[]): ScoreRow[] {
  return [...rows].sort(
    (a, b) => b.kills - a.kills || a.deaths - b.deaths || b.assists - a.assists || a.id - b.id,
  );
}

/** What a row says, so a redraw happens only when a line changed. */
function rowsKey(rows: readonly ScoreRow[]): string {
  return rows
    .map((r) => `${r.id}|${r.name}|${r.color}|${r.kills}|${r.deaths}|${r.assists}|${r.isSelf}`)
    .join('\n');
}

const COLUMNS = [
  ['kills', 'Kills'],
  ['deaths', 'Deaths'],
  ['assists', 'Assists'],
] as const;

/**
 * Everyone in the room with their kills, deaths and assists, shown while Tab is held over an even
 * dim of the view, as the other reading surfaces are: a title, the bar, and a table of plain lines,
 * each name in its cook's color and yours marked "you" in brass.
 */
export class Scoreboard {
  readonly element: HTMLElement;
  private readonly body = el('tbody');
  /** What the table is in, which cuts it off in a window too short for every row. */
  private readonly scroller = el('div', { class: 'scoreboard-scroll' });
  private readonly head: HTMLElement;
  private rows: readonly ScoreRow[] = [];
  private key = '';
  private drawn = '';

  constructor(parent: HTMLElement) {
    const header = el('tr', {}, [
      // An empty column head over the names, so the table keeps its first column; it is named for a reader.
      el('th', { attrs: { scope: 'col' } }, [
        el('span', { class: 'visually-hidden', text: 'Cook' }),
      ]),
      ...COLUMNS.map(([column, label]) =>
        el('th', { class: `scoreboard-number is-${column}`, text: label, attrs: { scope: 'col' } }),
      ),
    ]);
    this.element = el(
      'section',
      { class: 'scoreboard', attrs: { 'aria-label': 'Scoreboard', hidden: '' } },
      [
        el('div', { class: 'scoreboard-body' }, [
          el('h2', { class: 'title scoreboard-title', text: 'Scoreboard' }),
          el('span', { class: 'bar' }),
          this.scroller,
        ]),
      ],
    );
    this.head = el('thead', {}, [header]);
    this.scroller.append(el('table', { class: 'scoreboard-table' }, [this.head, this.body]));
    parent.append(this.element);
    // A window made shorter while the key is held.
    window.addEventListener('resize', () => {
      if (this.shown) this.fit();
    });
  }

  /** Whether the scoreboard is up. */
  get shown(): boolean {
    return !this.element.hidden;
  }

  /** The rows as they are shown, best first, for tests and debugging. */
  get ranked(): readonly ScoreRow[] {
    return rankRows(this.rows);
  }

  /** Everyone in the room, in any order; the scoreboard ranks them. */
  setRows(rows: readonly ScoreRow[]): void {
    this.rows = rows;
    const key = rowsKey(rows);
    if (key === this.key) return;
    this.key = key;
    if (!this.shown) return;
    this.draw();
    this.fit();
  }

  setShown(shown: boolean): void {
    if (shown === this.shown) return;
    // Drawn as it comes up, not as each change comes in while it is away.
    if (shown) this.draw();
    this.element.hidden = !shown;
    if (shown) this.fit();
  }

  /**
   * In a window too short for every row, the rows that do not fit are left out, rather than the list
   * being scrolled, which nothing can do while the key is held and which would take the column
   * names with it: those that fit are the ones ending with this player's own row, if it would
   * otherwise be cut off, so it is always there, or else the top of the list.
   */
  private fit(): void {
    const rows = [...this.body.children] as HTMLElement[];
    for (const row of rows) row.classList.remove('is-cut');
    const box = this.scroller;
    if (rows.length === 0 || box.scrollHeight <= box.clientHeight) return;
    const room = box.clientHeight - this.head.offsetHeight;
    const capacity = Math.max(1, Math.floor(room / rows[0]!.offsetHeight));
    const self = rows.findIndex((row) => row.classList.contains('is-self'));
    const start = self >= capacity ? self - capacity + 1 : 0;
    rows.forEach((row, i) => row.classList.toggle('is-cut', i < start || i >= start + capacity));
  }

  private draw(): void {
    if (this.drawn === this.key && this.body.childElementCount > 0) return;
    this.drawn = this.key;
    this.body.replaceChildren(
      ...rankRows(this.rows).map((row) => {
        const name = el('span', { class: 'scoreboard-cook', text: row.name });
        name.style.setProperty('--player-color', row.color);
        const line = el('tr', { class: `scoreboard-row${row.isSelf ? ' is-self' : ''}` }, [
          el('th', { class: 'scoreboard-name', attrs: { scope: 'row' } }, [
            el('span', { class: 'scoreboard-who' }, [
              name,
              // After the name, so a screen reader hears the name first; the styles put it in front.
              row.isSelf ? el('span', { class: 'scoreboard-you', text: 'you' }) : null,
            ]),
          ]),
          ...COLUMNS.map(([column]) =>
            el('td', { class: `scoreboard-number is-${column}`, text: String(row[column]) }),
          ),
        ]);
        return line;
      }),
    );
  }
}
