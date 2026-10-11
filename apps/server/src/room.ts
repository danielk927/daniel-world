import {
  DEATH_SECONDS,
  EYE_HEIGHT,
  KNIFE_COOLDOWN_INPUTS,
  PUNCH_COOLDOWN_INPUTS,
  Keys,
  PLAYER_COLORS,
  RESPAWN_PROTECTION_SECONDS,
  SNAPSHOT_EVERY_TICKS,
  TICK_RATE,
  thrownKnife,
  NAME_MAX_LENGTH,
  DEFAULT_PREFS,
  samePrefs,
  knifeLook,
  lookFields,
  createPlayerState,
  isInsideCollider,
  spawnPoint,
  encode,
  stepPlayer,
  type PlayerInfo,
  type PlayerInput,
  type PlayerSnapshot,
  type PlayerState,
  type Prefs,
  type ServerMessage,
  type StuckKnife,
  COOLER_OPEN_DELAY_INPUTS,
  coolerColliders,
  inPlayArea,
  knifeInCoolerDoor,
  punchOnCoolerDoor,
  type CoolerDent,
  type CoolerHitMessage,
  type CoolerState,
} from '@world/shared';
import { RoomCooler } from './cooler.ts';
import { PositionHistory, RoomKnives, type KnifeCandidate, type KnifeEvent } from './knives.ts';

/** Inputs waiting to be simulated (0.4 s) are capped so a flood cannot build up unbounded latency. */
export const MAX_QUEUED_INPUTS = Math.round(0.4 * TICK_RATE);
/**
 * A player may simulate at most one input per tick on average. Unused ticks bank a little credit
 * (0.3 s) so a burst after a network hiccup catches up quickly, but never enough to speed hack.
 */
export const MAX_INPUT_CREDIT = Math.round(0.3 * TICK_RATE);
/**
 * A player who sends nothing for this many ticks (0.5 s) is simulated with an idle input, so going
 * silent mid-jump (or with a lag switch) cannot freeze them in the air.
 */
export const IDLE_STEP_AFTER_TICKS = Math.round(0.5 * TICK_RATE);
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
  /** Lives in the room (Chef Skinner), driven by the server, not a visitor's socket. */
  readonly resident: boolean;
  readonly name: string;
  readonly color: string;
  readonly state: PlayerState;
  readonly queue: QueuedInput[];
  credit: number;
  /** Consecutive ticks without any queued input. */
  idleTicks: number;
  /** Highest input sequence applied so far, -1 before the first. */
  lastSeq: number;
  /** Sequence number of the newest input received (applied, queued or dropped), -1 before any. */
  received: number;
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
  /**
   * The first of this player's inputs whose step sees the walk-in's doorway open: Infinity while
   * the door holds, a little ahead of their newest input once it bursts, 0 for later arrivals.
   */
  coolerFrom: number;
  /** Where the player was over the last few ticks, so knives can be checked against the past. */
  readonly history: PositionHistory;
  /** What the visitor has chosen for themselves; replaced whole when they change it. */
  prefs: Readonly<Prefs>;
  send: (data: string) => void;
}

export interface NewPlayer {
  id: number;
  name: string;
  send: (data: string) => void;
  spawn?: { x: number; z: number; yaw: number } | undefined;
  resident?: boolean;
  prefs?: Readonly<Prefs> | undefined;
}

export class Room {
  readonly code: string;
  readonly players = new Map<number, RoomPlayer>();
  tick = 0;
  private arrivals = 0;
  readonly knives = new RoomKnives();
  /** The walk-in's door, whole until enough hits burst it open. */
  readonly cooler = new RoomCooler();
  /** Scratch list of who can be hit this tick. */
  private readonly candidates: KnifeCandidate[] = [];
  /** Told whenever a knife knocks someone out. */
  onKnockout: ((from: number, to: number) => void) | null = null;
  /** Told when the walk-in's door bursts open, once everyone has been told of the hit. */
  onCoolerBurst: (() => void) | null = null;

  constructor(code: string) {
    this.code = code;
  }

  /** Visitors in the room, not counting residents. */
  get visitors(): number {
    let count = 0;
    for (const player of this.players.values()) if (!player.resident) count++;
    return count;
  }

  /** No visitors left. Residents do not keep a room open. */
  get isEmpty(): boolean {
    return this.visitors === 0;
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
    const open = this.cooler.burst;
    const colliders = coolerColliders(open);
    // One idle step settles a reconnecting player's hint: out of counters, inside the walls, on the floor.
    stepPlayer(state, { keys: 0, yaw: state.yaw, pitch: 0 }, colliders);
    // A hint wedged between fixtures (or from an older world), or in a cooler shut since, can fail
    // to settle; use a fresh spot.
    if (isInsideCollider(state, colliders) || !inPlayArea(state.x, state.z, open)) {
      const fresh = this.nextSpawn();
      state = createPlayerState(fresh.x, fresh.z, fresh.yaw);
    }
    return state;
  }

  /**
   * Adds a player and tells everyone else. The caller keeps the room within MAX_PLAYERS_PER_ROOM,
   * whose colors run out after that.
   */
  add(joining: NewPlayer): RoomPlayer {
    const state = this.standAt(joining.spawn ?? this.nextSpawn());
    const player: RoomPlayer = {
      id: joining.id,
      resident: joining.resident ?? false,
      name: joining.name,
      color: this.pickColor(),
      state,
      queue: [],
      credit: 1,
      idleTicks: 0,
      lastSeq: -1,
      received: -1,
      deadUntil: null,
      protectedUntil: 0,
      lastThrowSeq: -Infinity,
      lastPunchSeq: -Infinity,
      armed: true,
      coolerFrom: this.cooler.burst ? 0 : Infinity,
      history: new PositionHistory(),
      prefs: { ...(joining.prefs ?? DEFAULT_PREFS) },
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
    const info: PlayerInfo = {
      id: player.id,
      name: player.name,
      color: player.color,
      prefs: { ...player.prefs },
    };
    if (player.resident) info.resident = true;
    return info;
  }

  /**
   * A player changed their prefs. Everything reads them fresh each tick (Chef Skinner's targeting,
   * knife hits), so they apply at once; everyone is told, to replay knives the same way.
   */
  setPrefs(player: RoomPlayer, prefs: Readonly<Prefs>): void {
    if (samePrefs(player.prefs, prefs)) return;
    player.prefs = { ...prefs };
    this.broadcast({ t: 'prefs', id: player.id, prefs: { ...prefs } });
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

  /**
   * Queue an input for the next ticks. A player's inputs come numbered one after another, as a
   * client numbers every tick it sends; the first may be any number, since a client counts on
   * through playing solo and reconnecting. Any other number is refused (false), queueing nothing:
   * the cooldowns and the knife's spread go by these numbers, and only a modified client skips
   * ahead (to throw every input, or pick its spread) or goes back.
   */
  enqueueInput(player: RoomPlayer, input: QueuedInput): boolean {
    if (player.received >= 0 && input.seq !== player.received + 1) return false;
    player.received = input.seq;
    player.queue.push({
      seq: input.seq,
      keys: input.keys,
      yaw: input.yaw,
      pitch: input.pitch,
      view: input.view,
    });
    // Keep latency bounded: drop the oldest. The client's reconciliation absorbs the difference.
    while (player.queue.length > MAX_QUEUED_INPUTS) player.queue.shift();
    return true;
  }

  /** Simulate one tick, and broadcast the resulting snapshot on every SNAPSHOT_EVERY_TICKS. */
  step(): void {
    this.tick++;
    for (const player of this.players.values()) {
      player.credit = Math.min(MAX_INPUT_CREDIT, player.credit + 1);
      if (player.queue.length === 0) {
        player.idleTicks++;
        if (player.idleTicks > IDLE_STEP_AFTER_TICKS) {
          const s = player.state;
          const open = this.cooler.isOpenAt(this.tick);
          stepPlayer(s, { keys: 0, yaw: s.yaw, pitch: s.pitch }, coolerColliders(open));
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
    const coolerOpen = this.cooler.isOpenAt(this.tick);
    for (const event of this.knives.step(this.tick, this.hittable(), coolerOpen)) {
      this.onKnife(event);
    }
    this.respawnDue();
    if (this.players.size === 0 || this.tick % SNAPSHOT_EVERY_TICKS !== 0) return;
    this.broadcast({
      t: 'snap',
      tick: this.tick,
      players: [...this.players.values()].map((p) => this.snapshotOf(p)),
    });
  }

  /** Simulate one input. A knocked-out player only falls; a standing one may throw or punch. */
  private apply(player: RoomPlayer, input: QueuedInput): void {
    const dead = player.deadUntil !== null;
    stepPlayer(
      player.state,
      dead ? { keys: 0, yaw: input.yaw, pitch: input.pitch } : input,
      coolerColliders(input.seq >= player.coolerFrom),
    );
    player.lastSeq = input.seq;
    player.armed = (input.keys & Keys.Armed) !== 0;
    // Counted in inputs, which `enqueueInput` keeps numbered one after another.
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
      // From the eye after this step, as the puncher's screen predicts it.
      const s = player.state;
      const on = punchOnCoolerDoor(s.x, s.y + EYE_HEIGHT, s.z, s.yaw, s.pitch);
      if (on) this.hitCooler(player.id, { ...on, by: 'fist' });
    }
  }

  /**
   * Someone hit the walk-in's door: everyone hears where, to dent it there. The hit that bursts it
   * tells each player which of their inputs first sees the doorway open, a little ahead of the
   * newest the server has, so their prediction agrees with the server and nobody is corrected.
   */
  private hitCooler(from: number, dent: CoolerDent, knife?: { id: number; at: number }): void {
    if (!this.cooler.hit(dent, this.tick)) return;
    const message: CoolerHitMessage = { t: 'cooler', from, dent };
    if (knife) message.knife = knife;
    if (!this.cooler.burst) {
      this.broadcast(message);
      return;
    }
    for (const player of this.players.values()) {
      player.coolerFrom = Math.max(0, player.received + COOLER_OPEN_DELAY_INPUTS);
      player.send(encode({ ...message, openFrom: player.coolerFrom }));
    }
    this.onCoolerBurst?.();
  }

  /** The walk-in's door, for a newcomer's welcome. */
  coolerState(): CoolerState {
    return this.cooler.state();
  }

  /**
   * The knife leaves the eye, after this input's step, spread by who threw it and on which input,
   * exactly as the thrower's client predicts.
   */
  private throwKnife(player: RoomPlayer, input: QueuedInput): void {
    const { yaw, pitch, seq } = input;
    player.lastThrowSeq = seq;
    const s = player.state;
    const knife = thrownKnife(s.x, s.y + EYE_HEIGHT, s.z, yaw, pitch, player.id, seq);
    const rewind = input.view === undefined ? 0 : this.tick - input.view;
    const id = this.knives.launch(player, knife, rewind);
    this.broadcast({
      t: 'knife',
      id,
      from: player.id,
      seq,
      x: knife.x,
      y: knife.y,
      z: knife.z,
      vx: knife.vx,
      vy: knife.vy,
      vz: knife.vz,
      ...lookFields(knifeLook(player.prefs.skin, player.prefs.finish)),
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
      const { x, y, z, id } = event.knife;
      const on = knifeInCoolerDoor(x, y, z);
      if (on) this.hitCooler(event.from, { ...on, by: 'knife' }, { id, at: event.at });
      return;
    }
    // One of this tick's candidates, standing: a knife hits nobody another knife hit this tick.
    const victim = this.players.get(event.to)!;
    victim.deadUntil = this.tick + DEATH_TICKS;
    this.broadcast({ t: 'kill', knife: event.knife, from: event.from, to: event.to, at: event.at });
    this.onKnockout?.(event.from, event.to);
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
