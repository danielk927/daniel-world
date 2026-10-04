import {
  DEATH_SECONDS,
  EYE_HEIGHT,
  KNIFE_COOLDOWN_INPUTS,
  PUNCH_COOLDOWN_INPUTS,
  Keys,
  PLAYER_COLORS,
  RESPAWN_PROTECTION_SECONDS,
  TICK_RATE,
  launchKnife,
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
  type StuckKnife,
} from '@world/shared';
import { PositionHistory, RoomKnives, type KnifeCandidate, type KnifeEvent } from './knives.ts';

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
/** A knocked-out player lies on the floor this many ticks. */
export const DEATH_TICKS = Math.round(DEATH_SECONDS * TICK_RATE);
/** Knives pass through a respawned player for this many ticks. */
export const PROTECTION_TICKS = Math.round(RESPAWN_PROTECTION_SECONDS * TICK_RATE);

export interface QueuedInput extends PlayerInput {
  seq: number;
  /** Server tick the client was showing other players at, for checking its knives. */
  view?: number | undefined;
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
  /** Tick at which a knocked-out player gets back up, or null while they are standing. */
  deadUntil: number | null;
  /** Knives pass through a freshly respawned player until this tick. */
  protectedUntil: number;
  /** Sequence of the input that last threw a knife. */
  lastThrowSeq: number;
  /** Sequence of the input that last punched. */
  lastPunchSeq: number;
  /** Holding the knife, as of the latest input. */
  armed: boolean;
  /** Where the player was over the last few ticks, so knives can be checked against the past. */
  readonly history: PositionHistory;
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
  readonly knives = new RoomKnives();
  /** Scratch list of who can be hit this tick. */
  private readonly candidates: KnifeCandidate[] = [];

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

  /** Golden-ratio steps spread arrivals evenly; the first player in a room gets the main spawn. */
  private nextSpawn(): { x: number; z: number; yaw: number } {
    return spawnPoint((this.arrivals++ * 0.381966) % 1);
  }

  /** A player standing at `spawn`, or at a fresh spawn point if that one does not settle. */
  private standAt(spawn: { x: number; z: number; yaw: number }): PlayerState {
    let state = createPlayerState(spawn.x, spawn.z, spawn.yaw);
    // One idle step settles a reconnecting player's hint: out of counters, inside the walls, on the floor.
    stepPlayer(state, { keys: 0, yaw: state.yaw, pitch: 0 });
    // A hint wedged between fixtures (or from an older world) can fail to settle; use a fresh spot.
    if (isInsideCollider(state)) {
      const fresh = this.nextSpawn();
      state = createPlayerState(fresh.x, fresh.z, fresh.yaw);
    }
    return state;
  }

  /** Adds a player and tells everyone else. The caller must check `isFull` first. */
  add(joining: NewPlayer): RoomPlayer {
    const state = this.standAt(joining.spawn ?? this.nextSpawn());
    const player: RoomPlayer = {
      id: joining.id,
      name: joining.name,
      color: this.pickColor(),
      state,
      queue: [],
      credit: 1,
      idleTicks: 0,
      lastSeq: -1,
      deadUntil: null,
      protectedUntil: 0,
      lastThrowSeq: -Infinity,
      lastPunchSeq: -Infinity,
      armed: true,
      history: new PositionHistory(),
      send: joining.send,
    };
    player.history.record(this.tick, state.x, state.y, state.z);
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
      dead: player.deadUntil !== null,
      armed: player.armed,
      ack: player.lastSeq,
    };
  }

  /** Queue an input for the next ticks. Stale or duplicate sequence numbers are ignored. */
  enqueueInput(player: RoomPlayer, input: QueuedInput): void {
    const newest =
      player.queue.length > 0 ? player.queue[player.queue.length - 1]!.seq : player.lastSeq;
    if (input.seq <= newest) return;
    player.queue.push({
      seq: input.seq,
      keys: input.keys,
      yaw: input.yaw,
      pitch: input.pitch,
      view: input.view,
    });
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
        this.apply(player, player.queue.shift()!);
        player.credit -= 1;
      }
    }
    for (const player of this.players.values()) {
      const s = player.state;
      player.history.record(this.tick, s.x, s.y, s.z);
    }
    for (const event of this.knives.step(this.tick, this.hittable())) this.onKnife(event);
    this.respawnDue();
    if (this.players.size === 0) return;
    this.broadcast({
      t: 'snap',
      tick: this.tick,
      players: [...this.players.values()].map((p) => this.snapshotOf(p)),
    });
  }

  /** Simulate one input. A knocked-out player only falls; a standing one may throw or punch. */
  private apply(player: RoomPlayer, input: QueuedInput): void {
    const dead = player.deadUntil !== null;
    stepPlayer(player.state, dead ? { keys: 0, yaw: input.yaw, pitch: input.pitch } : input);
    player.lastSeq = input.seq;
    player.armed = (input.keys & Keys.Armed) !== 0;
    const cooledDown = input.seq - player.lastThrowSeq >= KNIFE_COOLDOWN_INPUTS;
    // Only a knife in hand can be thrown.
    if (!dead && player.armed && input.keys & Keys.Throw && cooledDown) {
      this.throwKnife(player, input);
    }
    // Only a bare hand punches. The puncher's own screen already shows it.
    const rested = input.seq - player.lastPunchSeq >= PUNCH_COOLDOWN_INPUTS;
    if (!dead && !player.armed && input.keys & Keys.Punch && rested) {
      player.lastPunchSeq = input.seq;
      this.broadcast({ t: 'punch', id: player.id }, player.id);
    }
  }

  /** The knife leaves the eye, after this input's step, exactly as the thrower's client predicts. */
  private throwKnife(player: RoomPlayer, input: QueuedInput): void {
    player.lastThrowSeq = input.seq;
    const s = player.state;
    const knife = launchKnife(s.x, s.y + EYE_HEIGHT, s.z, input.yaw, input.pitch);
    const rewind = input.view === undefined ? 0 : this.tick - input.view;
    const id = this.knives.launch(player.id, knife, rewind);
    this.broadcast({
      t: 'knife',
      id,
      from: player.id,
      seq: input.seq,
      x: knife.x,
      y: knife.y,
      z: knife.z,
      vx: knife.vx,
      vy: knife.vy,
      vz: knife.vz,
    });
  }

  /** Players a knife can hit right now: standing, and past their respawn protection. */
  private hittable(): readonly KnifeCandidate[] {
    this.candidates.length = 0;
    for (const player of this.players.values()) {
      if (player.deadUntil === null && player.protectedUntil <= this.tick) {
        this.candidates.push(player);
      }
    }
    return this.candidates;
  }

  private onKnife(event: KnifeEvent): void {
    if (event.kind === 'stuck') {
      this.broadcast({ t: 'stuck', knife: event.knife, at: event.at });
      return;
    }
    const victim = this.players.get(event.to);
    if (!victim || victim.deadUntil !== null) return;
    victim.deadUntil = this.tick + DEATH_TICKS;
    this.broadcast({ t: 'kill', knife: event.knife, from: event.from, to: event.to, at: event.at });
  }

  /** Knocked-out players whose time is up stand up again at a spawn point, briefly protected. */
  private respawnDue(): void {
    for (const player of this.players.values()) {
      if (player.deadUntil === null || player.deadUntil > this.tick) continue;
      Object.assign(player.state, this.standAt(this.nextSpawn()));
      player.deadUntil = null;
      player.protectedUntil = this.tick + PROTECTION_TICKS;
      const s = player.state;
      player.history.record(this.tick, s.x, s.y, s.z);
      this.broadcast({ t: 'respawn', player: this.snapshotOf(player) });
    }
  }

  /** Knives stuck around the room, for a newcomer's welcome. */
  stuckKnives(): StuckKnife[] {
    return this.knives.stuckKnives();
  }

  broadcast(message: ServerMessage, exceptId?: number): void {
    const data = encode(message);
    for (const player of this.players.values()) {
      if (player.id !== exceptId) player.send(data);
    }
  }
}
