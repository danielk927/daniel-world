import {
  PLAYER_COLORS,
  MAX_PLAYERS_PER_ROOM,
  NAME_MAX_LENGTH,
  createPlayerState,
  isInsideCollider,
  spawnPoint,
  encode,
  stepPlayer,
  type PlayerInfo,
  type PlayerInput,
  type PlayerSnapshot,
  type PlayerState,
  type ServerMessage,
} from '@world/shared';

/** Inputs waiting to be simulated are capped so a flood cannot build up unbounded latency. */
export const MAX_QUEUED_INPUTS = 8;
/**
 * A player may simulate at most one input per tick on average. Unused ticks bank a little credit
 * so a burst after a network hiccup catches up quickly, but never enough to speed hack.
 */
export const MAX_INPUT_CREDIT = 6;
/**
 * A player who sends nothing for this many ticks is simulated with an idle input, so going silent
 * mid-jump (or with a lag switch) cannot freeze them in the air.
 */
export const IDLE_STEP_AFTER_TICKS = 10;

export interface QueuedInput extends PlayerInput {
  seq: number;
}

export interface RoomPlayer {
  readonly id: number;
  readonly name: string;
  readonly color: string;
  readonly state: PlayerState;
  readonly queue: QueuedInput[];
  credit: number;
  /** Consecutive ticks without any queued input. */
  idleTicks: number;
  /** Highest input sequence applied so far, -1 before the first. */
  lastSeq: number;
  send: (data: string) => void;
}

export interface NewPlayer {
  id: number;
  name: string;
  send: (data: string) => void;
  spawn?: { x: number; z: number; yaw: number } | undefined;
}

export class Room {
  readonly code: string;
  readonly players = new Map<number, RoomPlayer>();
  tick = 0;
  private arrivals = 0;

  constructor(code: string) {
    this.code = code;
  }

  get isFull(): boolean {
    return this.players.size >= MAX_PLAYERS_PER_ROOM;
  }

  get isEmpty(): boolean {
    return this.players.size === 0;
  }

  private pickColor(): string {
    const used = new Set([...this.players.values()].map((p) => p.color));
    return PLAYER_COLORS.find((c) => !used.has(c)) ?? PLAYER_COLORS[0];
  }

  /** Adds a player and tells everyone else. The caller must check `isFull` first. */
  add(joining: NewPlayer): RoomPlayer {
    // Golden-ratio steps spread arrivals evenly; the first player in a room gets the main spawn.
    const next = (): { x: number; z: number; yaw: number } =>
      spawnPoint((this.arrivals++ * 0.381966) % 1);
    const spawn = joining.spawn ?? next();
    let state = createPlayerState(spawn.x, spawn.z, spawn.yaw);
    // One idle step settles a reconnecting player's hint: out of counters, inside the walls, on the floor.
    stepPlayer(state, { keys: 0, yaw: state.yaw, pitch: 0 });
    // A hint wedged between fixtures (or from an older world) can fail to settle; use a fresh spot.
    if (isInsideCollider(state)) {
      const fresh = next();
      state = createPlayerState(fresh.x, fresh.z, fresh.yaw);
    }
    const player: RoomPlayer = {
      id: joining.id,
      name: joining.name,
      color: this.pickColor(),
      state,
      queue: [],
      credit: 1,
      idleTicks: 0,
      lastSeq: -1,
      send: joining.send,
    };
    this.players.set(player.id, player);
    this.broadcast({ t: 'join', player: this.info(player) }, player.id);
    return player;
  }

  remove(id: number): void {
    if (!this.players.delete(id)) return;
    this.broadcast({ t: 'leave', id });
  }

  /** `name`, or `name 2`, `name 3`... if someone in the room already has it. */
  uniqueName(name: string): string {
    const taken = new Set([...this.players.values()].map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) {
      const suffix = ` ${n}`;
      const candidate =
        Array.from(name)
          .slice(0, NAME_MAX_LENGTH - suffix.length)
          .join('')
          .trimEnd() + suffix;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  info(player: RoomPlayer): PlayerInfo {
    return { id: player.id, name: player.name, color: player.color };
  }

  playerList(): PlayerInfo[] {
    return [...this.players.values()].map((p) => this.info(p));
  }

  snapshotOf(player: RoomPlayer): PlayerSnapshot {
    const s = player.state;
    return {
      id: player.id,
      x: s.x,
      y: s.y,
      z: s.z,
      vx: s.vx,
      vy: s.vy,
      vz: s.vz,
      yaw: s.yaw,
      pitch: s.pitch,
      grounded: s.grounded,
      ack: player.lastSeq,
    };
  }

  /** Queue an input for the next ticks. Stale or duplicate sequence numbers are ignored. */
  enqueueInput(player: RoomPlayer, input: QueuedInput): void {
    const newest =
      player.queue.length > 0 ? player.queue[player.queue.length - 1]!.seq : player.lastSeq;
    if (input.seq <= newest) return;
    player.queue.push({ seq: input.seq, keys: input.keys, yaw: input.yaw, pitch: input.pitch });
    // Keep latency bounded: drop the oldest. The client's reconciliation absorbs the difference.
    while (player.queue.length > MAX_QUEUED_INPUTS) player.queue.shift();
  }

  /** Simulate one tick and broadcast the resulting snapshot. */
  step(): void {
    this.tick++;
    for (const player of this.players.values()) {
      player.credit = Math.min(MAX_INPUT_CREDIT, player.credit + 1);
      if (player.queue.length === 0) {
        player.idleTicks++;
        if (player.idleTicks > IDLE_STEP_AFTER_TICKS) {
          const s = player.state;
          stepPlayer(s, { keys: 0, yaw: s.yaw, pitch: s.pitch });
          player.credit = 0;
        }
        continue;
      }
      player.idleTicks = 0;
      while (player.credit >= 1 && player.queue.length > 0) {
        const input = player.queue.shift()!;
        stepPlayer(player.state, input);
        player.lastSeq = input.seq;
        player.credit -= 1;
      }
    }
    if (this.players.size === 0) return;
    this.broadcast({
      t: 'snap',
      tick: this.tick,
      players: [...this.players.values()].map((p) => this.snapshotOf(p)),
    });
  }

  broadcast(message: ServerMessage, exceptId?: number): void {
    const data = encode(message);
    for (const player of this.players.values()) {
      if (player.id !== exceptId) player.send(data);
    }
  }
}
