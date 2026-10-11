import {
  DOORS,
  EYE_HEIGHT,
  KNIFE_GRAVITY,
  KNIFE_MAX_FLIGHT_SECONDS,
  KNIFE_SPEED,
  Keys,
  MAX_PITCH,
  ROOM_HALF_X,
  TICK_RATE,
  flyKnife,
  launchKnife,
  wrapAngle,
  type KnifeTarget,
} from '@world/shared';
import type { Room, RoomPlayer } from './room.ts';

/**
 * Chef Skinner, the kitchen's resident cook, locked in the walk-in of every room until someone
 * breaks its door down (`WalkInChef`). Out, he is a player like any other as far as the room is
 * concerned: each tick he queues one input, which the room simulates with the same movement,
 * cooldowns and knife physics as everyone else's, and every screen sees him through the same
 * snapshots.
 *
 * He walks the aisles and pauses at stations. Every few seconds he picks a cook in view, stops,
 * turns to face them (long enough to see it coming), and throws, leading his target and not quite
 * perfectly. He leaves alone anyone who just arrived, and anyone standing still: a visitor reading
 * about a station is safe. A visitor can turn him off for themselves (`prefs.chef`): he never picks
 * them and gives up on them mid wind-up, and his knives and theirs pass through each other.
 */

export const CHEF_NAME = 'Chef Skinner';

/** The middle of the walk-in's doorway, in the kitchen's east wall. */
const DOORWAY = { x: ROOM_HALF_X, z: (DOORS.walkIn.from + DOORS.walkIn.to) / 2 } as const;

/** The back of the cold room, south of the shelves along its east wall, which end 0.8 m north. */
const BACK = { x: 10.9, z: -3.1 } as const;

/**
 * Where he starts: at the back of the cold room, clear of its shelves and of the door lying open
 * along its south wall, facing the doorway, so whoever broke it in sees him across the cold room.
 */
export const CHEF_SPAWN = {
  ...BACK,
  yaw: Math.atan2(-(DOORWAY.x - BACK.x), -(DOORWAY.z - BACK.z)),
} as const;

const seconds = (s: number): number => Math.round(s * TICK_RATE);
/**
 * He comes out this long after the walk-in's door bursts. The burst shows on each screen when the
 * fist or knife that made it gets there, a little after the room decides it; by now it has shown
 * on every screen, so nobody sees him in the room before they see the door give.
 */
export const ENTRANCE_TICKS = seconds(1);
/** He stands his ground this long as he comes out, shouting, before he storms out. */
const ENTRANCE_STAND_TICKS = seconds(1);
/**
 * A newcomer gets this long to look around before he takes any interest, and so does everyone in
 * the room when he comes out of the walk-in.
 */
export const GRACE_TICKS = seconds(8);
/** Only cooks who moved this recently are fair game; standing still means reading. */
export const STILL_TICKS = seconds(3);
/** He stands and faces his target this long before the knife leaves his hand. */
export const WIND_UP_TICKS = seconds(0.6);
/** Time between throws, at random within this range. */
const REST_TICKS: readonly [number, number] = [seconds(6), seconds(14)];
/**
 * Having lost his shot mid wind-up (the cook went behind something, or turned him off), he walks
 * on this long before he looks for another. Picking again at once had him wind up afresh every
 * time a pacing cook turned, and stand there for good, never throwing.
 */
const RETRY_TICKS = seconds(2);
/** Closer than this is too easy to be fun, further is too far to be fair. */
const MIN_RANGE = 3;
const MAX_RANGE = 16;
/** His aim wanders this far either way (radians), so most throws miss a cook on the move. */
const AIM_ERROR_YAW = 0.1;
const AIM_ERROR_PITCH = 0.045;
/** He says something at most this often, so the chat stays the visitors'. */
const QUIET_TICKS = seconds(25);
/** Where on the body he aims, above the feet. */
const AIM_HEIGHT = 1.1;
/** How fast he turns, radians per tick (4.4 a second), so he swings round like a person, not a turret. */
const TURN_RATE = 4.4 / TICK_RATE;
/** A waypoint counts as reached within this distance. */
const ARRIVED = 0.45;
/** Making less progress than this over STUCK_TICKS means something is in the way. */
const STUCK_TICKS = seconds(1.5);
const STUCK_PROGRESS = 0.3;

const LINES_ON_HIT = [
  'Get out of my kitchen!',
  'Too slow, chef.',
  'Every second counts.',
  'Who let you in here?',
  'Again. From the top.',
];
const LINES_ON_KNOCKED_OUT = ['Sacré bleu!', 'You will regret that.', 'My kitchen!'];
/** What he shouts as he comes out of the walk-in. */
export const ENTRANCE_LINES: readonly string[] = [
  'Who locked me in the walk-in?!',
  'Do you know how cold it is in there?',
  'Finally! Who shut that door on me?',
  'Somebody will pay for that door.',
];

/**
 * The aisles as a graph: rows between the fixtures and columns at the ends of the room, and a way
 * out of the walk-in from the middle of the cold room, through its doorway, to the east column.
 * He is only ever out with the walk-in open. Every edge is a straight walk that clears the fixtures
 * (the cold room's shelves, the door lying open along its south wall and the doorway's frame among
 * them) by more than a player's radius.
 */
const ROWS: readonly (readonly [number, readonly number[]])[] = [
  // The aisle by the dining room doors, between the pass and the south wall.
  [5.3, [-6.6, -3, 0, 3, 6.3]],
  // Between the pass and the piano.
  [2.6, [-6.6, -2.6, 0, 2.6, 6.3]],
  // Between the piano and the two islands.
  [-2.6, [-6.6, -2.6, 0, 2.6, 6.3]],
  // Along the window counter.
  [-5.3, [-6.6, -3.2, 0, 3.2, 6.3]],
];
/** The middle of the cold room's floor, between the shelves and the open door. */
const COLD_ROOM = { x: 9.7, z: -3.7 } as const;
/** Just inside the kitchen at the walk-in's doorway, beside the east column's two northern rows. */
const AT_THE_DOORWAY = { x: 7.3, z: DOORWAY.z } as const;

export interface Waypoint {
  readonly x: number;
  readonly z: number;
  readonly next: number[];
}

function buildWaypoints(): Waypoint[] {
  const points: Waypoint[] = [];
  const index = new Map<string, number>();
  const at = (x: number, z: number): number => {
    const key = `${x},${z}`;
    let i = index.get(key);
    if (i === undefined) {
      i = points.push({ x, z, next: [] }) - 1;
      index.set(key, i);
    }
    return i;
  };
  const link = (a: number, b: number): void => {
    points[a]!.next.push(b);
    points[b]!.next.push(a);
  };
  for (const [z, xs] of ROWS) {
    for (let i = 1; i < xs.length; i++) link(at(xs[i - 1]!, z), at(xs[i]!, z));
  }
  // The end columns join every row; the middle joins the two northern rows between the islands.
  for (const x of [-6.6, 6.3]) {
    for (let r = 1; r < ROWS.length; r++) link(at(x, ROWS[r - 1]![0]), at(x, ROWS[r]![0]));
  }
  link(at(0, -2.6), at(0, -5.3));
  // Out of the walk-in, through the doorway, to the east column either side of it.
  const doorway = at(AT_THE_DOORWAY.x, AT_THE_DOORWAY.z);
  link(at(COLD_ROOM.x, COLD_ROOM.z), doorway);
  link(doorway, at(6.3, -2.6));
  link(doorway, at(6.3, -5.3));
  return points;
}

export const WAYPOINTS: readonly Waypoint[] = buildWaypoints();

export interface Aim {
  readonly yaw: number;
  readonly pitch: number;
}

/**
 * The throw from `eye` that hits `target` (by its feet) if it keeps moving at its velocity, or
 * null if it is out of reach or something is in the way. Checked by flying the knife, with the
 * walk-in open, as it always is while he is out.
 */
export function aimAt(
  eye: { x: number; y: number; z: number },
  target: { x: number; y: number; z: number; vx: number; vz: number },
  thrower: number,
  id: number,
): Aim | null {
  // Lead the target by the flight time, refined twice: the time depends on where it ends up.
  let x = target.x;
  let z = target.z;
  let aim: Aim | null = null;
  for (let i = 0; i < 3; i++) {
    const dx = x - eye.x;
    const dz = z - eye.z;
    const d = Math.hypot(dx, dz);
    const h = target.y + AIM_HEIGHT - eye.y;
    // The low arc of the two that reach (d, h) at the knife's speed.
    const v2 = KNIFE_SPEED * KNIFE_SPEED;
    const g = KNIFE_GRAVITY;
    const disc = v2 * v2 - g * (g * d * d + 2 * h * v2);
    if (disc < 0 || d < 1e-6) return null;
    const pitch = Math.atan((v2 - Math.sqrt(disc)) / (g * d));
    if (Math.abs(pitch) > MAX_PITCH) return null;
    aim = { yaw: Math.atan2(-dx, -dz), pitch };
    const flight = d / (KNIFE_SPEED * Math.cos(pitch));
    x = target.x + target.vx * flight;
    z = target.z + target.vz * flight;
  }
  if (!aim) return null;
  // Fly it: anything between them (a counter, the hood) stops the knife first.
  const knife = launchKnife(eye.x, eye.y, eye.z, aim.yaw, aim.pitch);
  const at: KnifeTarget = { id, x, y: target.y, z };
  const impact = flyKnife(knife, KNIFE_MAX_FLIGHT_SECONDS, [at], thrower, true);
  return impact?.kind === 'player' ? aim : null;
}

type Plan =
  | { readonly kind: 'walk' }
  | { readonly kind: 'pause'; until: number; look: number }
  | { readonly kind: 'wind-up'; readonly target: number; until: number };

export class Chef {
  readonly player: RoomPlayer;
  private readonly room: Room;
  private readonly random: () => number;
  private seq = 0;
  private yaw: number = CHEF_SPAWN.yaw;
  private pitch = 0;
  private plan: Plan = { kind: 'walk' };
  private from = -1;
  private to: number;
  /** When each cook arrived, and when they last moved, by id. */
  private readonly arrived = new Map<number, number>();
  private readonly moved = new Map<number, number>();
  private nextThrow: number;
  private wasDown = false;
  private spokeAt = -Infinity;
  private progressAt = 0;
  private progressDistance = Infinity;

  /**
   * He comes out of the walk-in into `room`, whose door has burst: at the back of the cold room,
   * shouting about it, and he stands there a moment before he walks out.
   */
  constructor(room: Room, id: number, random: () => number = Math.random) {
    this.room = room;
    this.random = random;
    this.player = room.add({
      id,
      name: room.uniqueName(CHEF_NAME),
      spawn: CHEF_SPAWN,
      send: () => {},
      resident: true,
    });
    this.to = this.nearestWaypoint();
    this.nextThrow = room.tick + this.rest();
    this.plan = { kind: 'pause', until: room.tick + ENTRANCE_STAND_TICKS, look: CHEF_SPAWN.yaw };
    this.say(ENTRANCE_LINES);
  }

  /** Whom he is winding up to throw at, if anyone. */
  get target(): number | null {
    return this.plan.kind === 'wind-up' ? this.plan.target : null;
  }

  /** He has knocked someone out. */
  onKnockout(victim: number): void {
    if (victim !== this.player.id && this.random() < 0.6) this.say(LINES_ON_HIT);
  }

  /** Someone has knocked him out. */
  onKnockedOut(): void {
    if (this.random() < 0.7) this.say(LINES_ON_KNOCKED_OUT);
  }

  /** Decide this tick's input and queue it; the room simulates it in `step` like anyone's. */
  think(): void {
    const tick = this.room.tick;
    this.watchCooks(tick);
    const s = this.player.state;
    const down = this.player.deadUntil !== null;
    if (down || this.wasDown) {
      // Knocked out, or just back up somewhere new: start walking again from where he stands.
      this.wasDown = down;
      this.plan = { kind: 'walk' };
      this.from = -1;
      this.to = this.nearestWaypoint();
      this.resetProgress(tick);
      this.send(0);
      return;
    }

    if (this.plan.kind === 'wind-up') {
      const victim = this.room.players.get(this.plan.target);
      const aim = victim && this.canTarget(victim, tick) ? this.aim(victim) : null;
      if (!aim) {
        this.plan = { kind: 'walk' };
        this.nextThrow = tick + RETRY_TICKS;
        this.resetProgress(tick);
      } else {
        this.turnTo(aim.yaw, aim.pitch);
        if (tick >= this.plan.until) {
          this.yaw = aim.yaw + (this.random() * 2 - 1) * AIM_ERROR_YAW;
          this.pitch = aim.pitch + (this.random() * 2 - 1) * AIM_ERROR_PITCH;
          this.nextThrow = tick + this.rest();
          this.plan = { kind: 'walk' };
          this.resetProgress(tick);
          this.send(Keys.Throw);
          return;
        }
        this.send(0);
        return;
      }
    }

    if (tick >= this.nextThrow) {
      const target = this.pickTarget(tick);
      if (target) {
        this.plan = { kind: 'wind-up', target: target.id, until: tick + WIND_UP_TICKS };
        this.send(0);
        return;
      }
    }

    if (this.plan.kind === 'pause') {
      this.turnTo(this.plan.look, 0);
      if (tick < this.plan.until) {
        this.send(0);
        return;
      }
      this.plan = { kind: 'walk' };
      this.resetProgress(tick);
    }

    const goal = WAYPOINTS[this.to]!;
    const distance = Math.hypot(goal.x - s.x, goal.z - s.z);
    if (distance < ARRIVED) {
      this.arrive(tick);
      this.send(0);
      return;
    }
    if (distance < this.progressDistance - STUCK_PROGRESS) {
      this.progressDistance = distance;
      this.progressAt = tick;
    } else if (tick - this.progressAt > STUCK_TICKS) {
      // Something is in the way (a cook, most likely): head for another waypoint.
      this.from = this.to;
      this.to = pick(WAYPOINTS[this.to]!.next, this.random);
      this.resetProgress(tick);
    }
    this.turnTo(Math.atan2(-(goal.x - s.x), -(goal.z - s.z)), 0);
    // Walk once he is roughly facing the way, rather than sidling off at an angle.
    const facing = Math.abs(wrapAngle(Math.atan2(-(goal.x - s.x), -(goal.z - s.z)) - this.yaw));
    this.send(facing < 0.6 ? Keys.Forward : 0);
  }

  /** At a waypoint: sometimes stop and look around, then on to a neighbor, rarely back again. */
  private arrive(tick: number): void {
    const here = WAYPOINTS[this.to]!;
    const onward = here.next.filter((n) => n !== this.from);
    this.from = this.to;
    this.to = pick(onward.length > 0 && this.random() < 0.9 ? onward : here.next, this.random);
    this.resetProgress(tick);
    if (this.random() < 0.3) {
      const until = tick + seconds(1 + this.random() * 2);
      this.plan = { kind: 'pause', until, look: this.random() * Math.PI * 2 };
    }
  }

  private watchCooks(tick: number): void {
    for (const player of this.room.players.values()) {
      if (player.resident) continue;
      if (!this.arrived.has(player.id)) this.arrived.set(player.id, tick);
      const s = player.state;
      if (Math.hypot(s.vx, s.vz) > 0.3 || !s.grounded) this.moved.set(player.id, tick);
    }
    for (const id of this.arrived.keys()) {
      if (!this.room.players.has(id)) {
        this.arrived.delete(id);
        this.moved.delete(id);
      }
    }
  }

  private canTarget(player: RoomPlayer, tick: number): boolean {
    if (player.resident || !player.prefs.chef) return false;
    if (player.deadUntil !== null || player.protectedUntil > tick) return false;
    if (tick - (this.arrived.get(player.id) ?? tick) < GRACE_TICKS) return false;
    if (tick - (this.moved.get(player.id) ?? -Infinity) > STILL_TICKS) return false;
    const me = this.player.state;
    const d = Math.hypot(player.state.x - me.x, player.state.z - me.z);
    return d >= MIN_RANGE && d <= MAX_RANGE;
  }

  /** The nearest cook he can fairly throw at and actually reach, if any. */
  private pickTarget(tick: number): RoomPlayer | null {
    const me = this.player.state;
    let best: RoomPlayer | null = null;
    let bestDistance = Infinity;
    for (const player of this.room.players.values()) {
      if (!this.canTarget(player, tick) || !this.aim(player)) continue;
      const d = Math.hypot(player.state.x - me.x, player.state.z - me.z);
      if (d < bestDistance) {
        best = player;
        bestDistance = d;
      }
    }
    return best;
  }

  private aim(victim: RoomPlayer): Aim | null {
    const s = this.player.state;
    const eye = { x: s.x, y: s.y + EYE_HEIGHT, z: s.z };
    return aimAt(eye, victim.state, this.player.id, victim.id);
  }

  private turnTo(yaw: number, pitch: number): void {
    const turn = wrapAngle(yaw - this.yaw);
    this.yaw = wrapAngle(this.yaw + Math.max(-TURN_RATE, Math.min(TURN_RATE, turn)));
    this.pitch += Math.max(-TURN_RATE, Math.min(TURN_RATE, pitch - this.pitch));
  }

  private nearestWaypoint(): number {
    const s = this.player.state;
    let best = 0;
    for (let i = 1; i < WAYPOINTS.length; i++) {
      const a = WAYPOINTS[i]!;
      const b = WAYPOINTS[best]!;
      if (Math.hypot(a.x - s.x, a.z - s.z) < Math.hypot(b.x - s.x, b.z - s.z)) best = i;
    }
    return best;
  }

  private resetProgress(tick: number): void {
    this.progressAt = tick;
    this.progressDistance = Infinity;
  }

  private rest(): number {
    return REST_TICKS[0] + Math.floor(this.random() * (REST_TICKS[1] - REST_TICKS[0]));
  }

  private send(keys: number): void {
    const pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, this.pitch));
    this.room.enqueueInput(this.player, {
      seq: this.seq++,
      keys: keys | Keys.Armed,
      yaw: this.yaw,
      pitch,
    });
  }

  private say(lines: readonly string[]): void {
    if (this.room.tick - this.spokeAt < QUIET_TICKS) return;
    this.spokeAt = this.room.tick;
    const text = pick(lines, this.random);
    this.room.broadcast({ t: 'chat', id: this.player.id, name: this.player.name, text });
  }
}

/**
 * Chef Skinner as every room has him: locked in its walk-in while the door holds, so he is not in
 * the room at all and nothing on any screen or on the wire gives him away. A second after the door
 * bursts he comes out (`chef`), and stays until the room empties, which takes him and the room with
 * it, so the next visitors find him locked in again. A room that empties in that second never has
 * him. He keeps one of the room's places all along (see the server).
 */
export class WalkInChef {
  /** He, once he is out of the walk-in. */
  chef: Chef | null = null;
  private readonly room: Room;
  private readonly newId: () => number;
  private readonly random: () => number;
  /** The tick he comes out on, once the door has burst. */
  private outAt: number | null = null;

  /** `newId` gives him his player id as he comes out, from the server's own count. */
  constructor(room: Room, newId: () => number, random: () => number = Math.random) {
    this.room = room;
    this.newId = newId;
    this.random = random;
    room.onCoolerBurst = () => {
      this.outAt = room.tick + ENTRANCE_TICKS;
    };
    room.onKnockout = (from, to) => {
      const chef = this.chef;
      if (!chef) return;
      if (from === chef.player.id) chef.onKnockout(to);
      if (to === chef.player.id) chef.onKnockedOut();
    };
  }

  /**
   * Before each step of the room, as a visitor's input arrives before it: lets him out when it is
   * time, and has him decide his input. That step is `room.tick + 1`, so on the tick he comes out
   * on, his first input is in it.
   */
  think(): void {
    // Nobody is left to come out to; the server drops a room as it empties anyway.
    if (this.room.isEmpty) this.outAt = null;
    if (!this.chef && this.outAt !== null && this.room.tick + 1 >= this.outAt) {
      this.chef = new Chef(this.room, this.newId(), this.random);
    }
    this.chef?.think();
  }
}

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length)]!;
}
