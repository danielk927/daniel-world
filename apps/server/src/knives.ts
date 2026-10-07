import {
  KNIFE_MAX_FLIGHT_SECONDS,
  KNIFE_MAX_STUCK,
  MAX_REWIND_MS,
  TICK_MS,
  TICK_SECONDS,
  chefSpares,
  flyKnife,
  type Cook,
  type KnifeImpact,
  type KnifeState,
  type KnifeTarget,
  type StuckKnife,
} from '@world/shared';

/** How many ticks back the server can rewind other players for a thrower. */
export const MAX_REWIND_TICKS = Math.round(MAX_REWIND_MS / TICK_MS);
/** Positions kept per player: enough to rewind as far as allowed, plus the current tick. */
const HISTORY = MAX_REWIND_TICKS + 2;

/** Where one player's feet were over the last few ticks, so knives can be checked against the past. */
export class PositionHistory {
  private readonly positions = new Float64Array(HISTORY * 3);
  private newest = -1;
  private count = 0;

  /** Record where the player is at `tick`. Ticks must be recorded in order. */
  record(tick: number, x: number, y: number, z: number): void {
    this.newest = tick;
    this.count = Math.min(HISTORY, this.count + 1);
    const i = (tick % HISTORY) * 3;
    this.positions[i] = x;
    this.positions[i + 1] = y;
    this.positions[i + 2] = z;
  }

  /** Where the player was at `tick`, clamped to the oldest and newest positions kept. */
  at(tick: number, out: { x: number; y: number; z: number }): void {
    const oldest = this.newest - this.count + 1;
    const t = Math.max(oldest, Math.min(this.newest, tick));
    const i = (t % HISTORY) * 3;
    out.x = this.positions[i]!;
    out.y = this.positions[i + 1]!;
    out.z = this.positions[i + 2]!;
  }
}

/** A player a knife could hit this tick, with where the thrower saw them. */
export interface KnifeCandidate extends Cook {
  readonly id: number;
  readonly history: PositionHistory;
}

interface Flying {
  readonly id: number;
  readonly from: number;
  /** Who threw it, as they are now: their prefs can change mid-flight. */
  readonly thrower: Cook;
  readonly state: KnifeState;
  /** How far back the thrower was seeing everyone else, in ticks. */
  readonly rewind: number;
}

export type KnifeEvent =
  | {
      readonly kind: 'stuck';
      readonly knife: StuckKnife;
      readonly at: number;
      /** Who threw it. */
      readonly from: number;
    }
  | {
      readonly kind: 'kill';
      readonly knife: number;
      readonly from: number;
      readonly to: number;
      readonly at: number;
    };

/**
 * A room's knives: those in flight, stepped every tick against where each thrower saw the other
 * players, and those stuck in the kitchen, newest last and capped.
 */
export class RoomKnives {
  private nextId = 0;
  private readonly flying: Flying[] = [];
  private readonly stuck: StuckKnife[] = [];
  /** Scratch targets, reused across ticks, and the ones one knife can hit. */
  private readonly pool: { id: number; x: number; y: number; z: number }[] = [];
  private readonly targets: KnifeTarget[] = [];

  /** Start a knife's flight. Returns its id. `rewind` is clamped to what the server allows. */
  launch(thrower: Cook & { readonly id: number }, state: KnifeState, rewind: number): number {
    const id = this.nextId++;
    const ticks = Math.max(0, Math.min(MAX_REWIND_TICKS, Math.round(rewind)));
    this.flying.push({ id, from: thrower.id, thrower, state, rewind: ticks });
    return id;
  }

  /** Knives stuck around the room, oldest first. */
  stuckKnives(): StuckKnife[] {
    return this.stuck.slice();
  }

  get inFlight(): number {
    return this.flying.length;
  }

  /**
   * Fly every knife one tick. `candidates` are the players who can be hit right now; each knife is
   * checked against where its thrower saw them. Knives that land or hit someone are reported.
   * `coolerOpen`: the walk-in's doorway lets knives through.
   */
  step(tick: number, candidates: readonly KnifeCandidate[], coolerOpen = false): KnifeEvent[] {
    const events: KnifeEvent[] = [];
    for (let i = 0; i < this.flying.length; i++) {
      const knife = this.flying[i]!;
      const impact = flyKnife(
        knife.state,
        TICK_SECONDS,
        this.targetsFor(knife, tick, candidates),
        knife.from,
        coolerOpen,
      );
      if (impact) {
        events.push(this.land(knife, impact));
      } else if (knife.state.t < KNIFE_MAX_FLIGHT_SECONDS) {
        continue;
      }
      this.flying.splice(i, 1);
      i--;
    }
    return events;
  }

  /** Who `knife` can hit, where its thrower saw them; never someone it spares (`chefSpares`). */
  private targetsFor(
    knife: Flying,
    tick: number,
    candidates: readonly KnifeCandidate[],
  ): readonly KnifeTarget[] {
    const { pool, targets } = this;
    targets.length = 0;
    for (const candidate of candidates) {
      if (chefSpares(knife.thrower, candidate)) continue;
      if (pool.length === targets.length) pool.push({ id: 0, x: 0, y: 0, z: 0 });
      const target = pool[targets.length]!;
      target.id = candidate.id;
      candidate.history.at(tick - knife.rewind, target);
      targets.push(target);
    }
    return targets;
  }

  private land(knife: Flying, impact: KnifeImpact): KnifeEvent {
    if (impact.kind === 'player') {
      return { kind: 'kill', knife: knife.id, from: knife.from, to: impact.id, at: impact.t };
    }
    const stuck: StuckKnife = {
      id: knife.id,
      x: impact.x,
      y: impact.y,
      z: impact.z,
      dx: impact.dx,
      dy: impact.dy,
      dz: impact.dz,
    };
    this.stuck.push(stuck);
    if (this.stuck.length > KNIFE_MAX_STUCK) this.stuck.shift();
    return { kind: 'stuck', knife: stuck, at: impact.t, from: knife.from };
  }
}
