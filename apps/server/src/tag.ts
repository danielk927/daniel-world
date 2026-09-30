import {
  TAG_NO_TAGBACK_SECONDS,
  TAG_RANGE,
  TAG_ROUND_SECONDS,
  TICK_MS,
  TICK_RATE,
  type GameStateMessage,
  type ServerMessage,
} from '@world/shared';
import type { RoomPlayer } from './room.ts';

export type TagEvent = Extract<ServerMessage, { t: 'game' } | { t: 'tagged' }>;

/**
 * One round of tag. The server decides everything: who is it, when a tag lands, and the score.
 * Score is the number of seconds a player has spent not being it; the highest score wins.
 */
export class TagRound {
  it: number;
  private ticksLeft = TAG_ROUND_SECONDS * TICK_RATE;
  /** Ticks each player has spent not being it. */
  private readonly scores = new Map<number, number>();
  /** The last tagger is safe from their victim until this many ticks have passed. */
  private noTagBack: { safe: number; ticks: number } | null = null;
  private ticksSinceBroadcast = 0;

  constructor(players: Iterable<RoomPlayer>, firstIt: number) {
    for (const p of players) this.scores.set(p.id, 0);
    this.it = firstIt;
  }

  get finished(): boolean {
    return this.ticksLeft <= 0;
  }

  /** Stop the round now (for example when too few players are left). */
  end(): void {
    this.ticksLeft = 0;
  }

  join(id: number): void {
    if (!this.scores.has(id)) this.scores.set(id, 0);
  }

  /** A player left. If it was them, pass it to someone at random. Returns events to broadcast. */
  leave(id: number, players: ReadonlyMap<number, RoomPlayer>, random: () => number): TagEvent[] {
    this.scores.delete(id);
    if (this.noTagBack?.safe === id) this.noTagBack = null;
    if (id !== this.it) return [this.state()];
    const ids = [...players.keys()].filter((other) => other !== id);
    const next = ids[Math.floor(random() * ids.length)];
    if (next === undefined) {
      this.ticksLeft = 0;
      return [this.state()];
    }
    this.it = next;
    this.noTagBack = null;
    return [this.state()];
  }

  /** Advance one tick after movement has been simulated. Returns events to broadcast. */
  step(players: ReadonlyMap<number, RoomPlayer>): TagEvent[] {
    const events: TagEvent[] = [];
    this.ticksLeft--;
    for (const [id] of players) {
      if (id !== this.it) this.scores.set(id, (this.scores.get(id) ?? 0) + 1);
    }
    if (this.noTagBack && --this.noTagBack.ticks <= 0) this.noTagBack = null;

    const chaser = players.get(this.it);
    if (chaser) {
      let victim: RoomPlayer | null = null;
      let best = TAG_RANGE * TAG_RANGE;
      for (const [id, p] of players) {
        if (id === this.it || this.noTagBack?.safe === id) continue;
        const dx = p.state.x - chaser.state.x;
        const dz = p.state.z - chaser.state.z;
        const d2 = dx * dx + dz * dz;
        if (d2 <= best && Math.abs(p.state.y - chaser.state.y) < 1.5) {
          best = d2;
          victim = p;
        }
      }
      if (victim) {
        events.push({ t: 'tagged', from: chaser.id, to: victim.id });
        this.noTagBack = { safe: chaser.id, ticks: TAG_NO_TAGBACK_SECONDS * TICK_RATE };
        this.it = victim.id;
        this.ticksSinceBroadcast = TICK_RATE;
      }
    }

    this.ticksSinceBroadcast++;
    if (this.finished || this.ticksSinceBroadcast >= TICK_RATE) {
      this.ticksSinceBroadcast = 0;
      events.push(this.state());
    }
    return events;
  }

  state(): GameStateMessage {
    return {
      t: 'game',
      phase: this.finished ? 'ended' : 'playing',
      it: this.finished ? null : this.it,
      remainingMs: Math.max(0, Math.round(this.ticksLeft * TICK_MS)),
      scores: [...this.scores.entries()]
        .map(([id, ticks]) => ({ id, score: Math.floor(ticks / TICK_RATE) }))
        .sort((a, b) => b.score - a.score || a.id - b.id),
    };
  }
}
