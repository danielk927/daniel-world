import { CatmullRomCurve3, Euler, Quaternion, Vector3, type PerspectiveCamera } from 'three';
import { EYE_HEIGHT } from '@world/shared';

/**
 * The camera behind the landing screen: a slow walk round the kitchen at head height, looking ahead
 * and a little in toward the cooking suite, and the swoop from wherever it is into the eyes of the
 * cook who has just entered.
 *
 * The loop goes round the suite and the pass together, so it runs along the aisle by the dining room
 * doors where every cook starts. The swoop follows the loop to that aisle and then glides along it to
 * the cook: it only ever goes where a cook could walk, never across the hot line, under the hood or
 * through the heat lamps over the pass.
 */

/** One lap of the loop, in seconds. */
export const LAP_SECONDS = 120;

/**
 * Clockwise seen from above (north up): west along the aisle behind the pass, round its west end and
 * north up the west aisle, east along the aisle behind the piano, south down the east aisle, and back
 * into the aisle behind the pass through the gap between its east end and the dish pit.
 */
const WAYPOINTS: readonly (readonly [x: number, y: number, z: number])[] = [
  [2.6, 1.78, 5.55],
  [0, 1.78, 5.55],
  [-2.6, 1.78, 5.55],
  [-4.6, 1.8, 5.45],
  [-5.75, 1.82, 4.6],
  [-6.15, 1.84, 2.9],
  [-6.15, 1.86, 0.3],
  [-5.95, 1.86, -1.95],
  [-4.4, 1.86, -2.6],
  [-1.5, 1.86, -2.6],
  [1.5, 1.86, -2.6],
  [4.4, 1.86, -2.6],
  [5.85, 1.85, -1.95],
  [6.0, 1.83, 0.3],
  [5.95, 1.81, 2.9],
  [5.6, 1.79, 4.5],
  [4.55, 1.78, 5.28],
];

/** The loop, closed and centripetal, so it never overshoots a corner or loops on itself. */
export const LOOP = new CatmullRomCurve3(
  WAYPOINTS.map(([x, y, z]) => new Vector3(x, y, z)),
  true,
  'centripetal',
);
// Fine steps, so equal steps along the loop are equal distances and the walk keeps an even pace.
LOOP.arcLengthDivisions = 20000;
export const LOOP_LENGTH = LOOP.getLength();

/** The way the camera goes is toward the point of the loop this far ahead, in meters. */
const STEP = 0.5;

/** Where on the loop (0 to 1) the landing starts: coming round the south-east corner. */
const START = 0.86;

/**
 * The camera faces the point of the loop this far ahead, turned this far in toward the suite (to the
 * right, as the loop goes clockwise) and tipped this far down toward the counters. Facing a point well
 * ahead turns the view gently round each corner, before the camera gets there.
 */
const LOOK_AHEAD = 5;
const LOOK_IN = (28 * Math.PI) / 180;
const LOOK_DOWN = (-5 * Math.PI) / 180;
/**
 * Coming up to a tight corner, facing that point would look across the camera's way, or even back
 * over its shoulder; so the view eases off to at most this far from the way the camera goes.
 */
const LOOK_OFF = (62 * Math.PI) / 180;

/**
 * With motion reduced, the old establishing shot holds still: from the south-east corner, a little
 * above head height, along the room under the hood toward the islands and the garden windows.
 */
const STILL_EYE = new Vector3(6.7, 2.25, 5.7);
const STILL_TARGET = new Vector3(-2.6, 1.15, -3.4);

/**
 * The aisle behind the pass, where cooks start: the loop runs along it between these two ends, and a
 * glide from either end to any spawn point stays in it.
 */
const AISLE_END_X = 4.2;
const AISLE_Z = 5.4;

/**
 * The swoop takes at least this long, and longer the farther it goes or the more it has to turn: at
 * about this pace, and this many radians a second.
 */
const SWOOP_MIN_SECONDS = 1.6;
const SWOOP_SPEED = 7;
const SWOOP_RAMP_SECONDS = 0.5;
const SWOOP_TURN_RATE = (65 * Math.PI) / 180;
/** Choosing which way round to go, a radian of turning counts as this many meters of going. */
const TURN_COST = 3;

const TAU = Math.PI * 2;

function wrap(u: number): number {
  return u - Math.floor(u);
}

/** An angle as the turn in (-pi, pi] it amounts to. */
function shortest(angle: number): number {
  return angle - TAU * Math.ceil((angle - Math.PI) / TAU);
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

/** Eases in and out with no jolt at either end. */
function smootherstep(t: number): number {
  return t * t * t * (t * (6 * t - 15) + 10);
}

/** The point of the loop nearest (x, z), searched once at load. */
function nearestOnLoop(x: number, z: number): number {
  const point = new Vector3();
  let best = 0;
  let bestDistance = Infinity;
  for (let i = 0; i < 4000; i++) {
    LOOP.getPointAt(i / 4000, point);
    const distance = Math.hypot(point.x - x, point.z - z);
    if (distance < bestDistance) {
      best = i / 4000;
      bestDistance = distance;
    }
  }
  return best;
}

/** The loop comes into the aisle behind the pass at its east end, and leaves it at its west end. */
const AISLE_IN = nearestOnLoop(AISLE_END_X, AISLE_Z);
const AISLE_OUT = nearestOnLoop(-AISLE_END_X, AISLE_Z);

/** Where the camera is `seconds` into the landing, from 0 to 1 round the loop. */
export function loopAt(seconds: number): number {
  return wrap(START + seconds / LAP_SECONDS);
}

/** The camera behind the landing, and the swoop from it into the game. */
export class LandingCamera {
  /** Whether the camera is on the loop, rather than holding the still shot. */
  private onLoop = false;
  /** Where on the loop the camera last was, and the way it faced. */
  private u = START;
  private yaw = 0;
  private readonly at = new Vector3();
  private readonly ahead = new Vector3();
  private readonly euler = new Euler(0, 0, 0, 'YXZ');
  private readonly spawn = new Vector3();

  // The swoop under way, planned on its first frame.
  private straight = true;
  private readonly from = new Vector3();
  private readonly fromQuat = new Quaternion();
  private startU = 0;
  private direction = 1;
  /** How far the swoop follows the loop before it glides along the aisle, in meters. */
  private alongLoop = 0;
  /** Where the glide along the aisle starts. */
  private readonly aisleStart = new Vector3();
  /** The turn from the way the landing faced to the way the cook will, in radians. */
  private turn = 0;
  /** How long the swoop takes, in seconds; it changes if the cook's spot moves on the way. */
  swoopSeconds = SWOOP_MIN_SECONDS;

  /** The landing: round the loop, or the still establishing shot when motion is reduced. */
  update(camera: PerspectiveCamera, seconds: number, still: boolean): void {
    this.onLoop = !still;
    if (still) {
      camera.position.copy(STILL_EYE);
      camera.lookAt(STILL_TARGET);
      return;
    }
    this.u = loopAt(seconds);
    LOOP.getPointAt(this.u, camera.position);
    this.yaw = this.yawAt(this.u);
    camera.quaternion.setFromEuler(this.euler.set(LOOK_DOWN, this.yaw, 0));
  }

  /** The way the landing faces from `u` on the loop, as a yaw. */
  private yawAt(u: number): number {
    const at = this.at;
    const ahead = this.ahead;
    LOOP.getPointAt(u, at);
    LOOP.getPointAt(wrap(u + STEP / LOOP_LENGTH), ahead);
    const going = Math.atan2(at.x - ahead.x, at.z - ahead.z);
    LOOP.getPointAt(wrap(u + LOOK_AHEAD / LOOP_LENGTH), ahead);
    const facing = Math.atan2(at.x - ahead.x, at.z - ahead.z) - LOOK_IN;
    return going + LOOK_OFF * Math.tanh(shortest(facing - going) / LOOK_OFF);
  }

  /** How far the landing's view turns going `distance` meters on round the loop from `u`, or back. */
  private turnAlong(u: number, distance: number): number {
    const steps = Math.ceil(Math.abs(distance) / 0.25);
    let last = this.yawAt(u);
    let turn = 0;
    for (let i = 1; i <= steps; i++) {
      const yaw = this.yawAt(wrap(u + (distance * i) / steps / LOOP_LENGTH));
      turn += shortest(yaw - last);
      last = yaw;
    }
    return turn;
  }

  /**
   * Plan the swoop from where the landing left the camera, `from` facing `fromQuat`, to the eye of
   * a cook standing at (x, z) and facing `facing`. From the loop it goes round the loop into the aisle
   * behind the pass, whichever way is shorter counting the turning, and turns evenly all the way, as
   * far as the landing's view would turn going round, so it keeps facing in toward the suite. From
   * the still shot it glides straight there.
   */
  planSwoop(from: Vector3, fromQuat: Quaternion, x: number, z: number, facing: Quaternion): void {
    this.from.copy(from);
    this.fromQuat.copy(fromQuat);
    this.straight = !this.onLoop;
    if (this.straight) {
      this.swoopSeconds = SWOOP_MIN_SECONDS;
      return;
    }
    const u = this.u;
    this.startU = u;
    const end = this.euler.setFromQuaternion(facing, 'YXZ').y;
    if (wrap(u - AISLE_IN) <= wrap(AISLE_OUT - AISLE_IN)) {
      // Already in the aisle: glide along it, turning the shorter way.
      this.alongLoop = 0;
      this.aisleStart.copy(from);
      this.turn = shortest(end - this.yaw);
    } else {
      const onward = wrap(AISLE_IN - u) * LOOP_LENGTH;
      const back = wrap(u - AISLE_OUT) * LOOP_LENGTH;
      const onwardTurn = this.turnAlong(u, onward) + shortest(end - this.yawAt(AISLE_IN));
      const backTurn = this.turnAlong(u, -back) + shortest(end - this.yawAt(AISLE_OUT));
      if (onward + TURN_COST * Math.abs(onwardTurn) <= back + TURN_COST * Math.abs(backTurn)) {
        this.direction = 1;
        this.alongLoop = onward;
        this.turn = onwardTurn;
        LOOP.getPointAt(AISLE_IN, this.aisleStart);
      } else {
        this.direction = -1;
        this.alongLoop = back;
        this.turn = backTurn;
        LOOP.getPointAt(AISLE_OUT, this.aisleStart);
      }
    }
    this.swoopSeconds = this.secondsFor(x, z);
  }

  /** How long the swoop takes to a cook standing at (x, z). */
  private secondsFor(x: number, z: number): number {
    const distance = this.alongLoop + Math.hypot(x - this.aisleStart.x, z - this.aisleStart.z);
    return Math.max(
      SWOOP_MIN_SECONDS,
      distance / SWOOP_SPEED + SWOOP_RAMP_SECONDS,
      Math.abs(this.turn) / SWOOP_TURN_RATE,
    );
  }

  /**
   * The swoop `progress` (0 to 1) of the way to the eye of the cook standing at (x, z), who will
   * face `facing`. The cook's spot can move while the camera is on its way (the room places them
   * once it has let them in); the camera follows it.
   */
  swoop(
    camera: PerspectiveCamera,
    progress: number,
    x: number,
    z: number,
    facing: Quaternion,
  ): void {
    const position = camera.position;
    if (this.straight) {
      const t = easeInOutCubic(progress);
      position.set(x, EYE_HEIGHT, z).lerp(this.from, 1 - t);
      // Arc up a little so the swoop clears the counters, staying under the hood.
      position.y += Math.sin(t * Math.PI) * 0.5;
      camera.quaternion.slerpQuaternions(this.fromQuat, facing, t);
      return;
    }
    const alongAisle = Math.hypot(x - this.aisleStart.x, z - this.aisleStart.z);
    this.swoopSeconds = this.secondsFor(x, z);
    const t = smootherstep(progress);
    const travelled = t * (this.alongLoop + alongAisle);
    if (travelled < this.alongLoop) {
      LOOP.getPointAt(wrap(this.startU + (this.direction * travelled) / LOOP_LENGTH), position);
    } else {
      this.spawn.set(x, this.aisleStart.y, z);
      const glide = alongAisle > 0 ? (travelled - this.alongLoop) / alongAisle : 1;
      position.copy(this.aisleStart).lerp(this.spawn, glide);
    }
    // Down to eye height over the second half, so the swoop never dips toward the counters early.
    position.y += (EYE_HEIGHT - position.y) * easeInOutCubic(Math.max(0, progress - 0.35) / 0.65);
    // Turning as it goes, to end on the way the cook faces, which can change on the way too.
    this.euler.setFromQuaternion(facing, 'YXZ');
    const pitch = LOOK_DOWN + (this.euler.x - LOOK_DOWN) * t;
    const turn = this.turn + shortest(this.euler.y - this.yaw - this.turn);
    camera.quaternion.setFromEuler(this.euler.set(pitch, this.yaw + turn * t, 0));
  }
}
