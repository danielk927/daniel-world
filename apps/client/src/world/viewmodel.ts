import {
  Color,
  CylinderGeometry,
  DirectionalLight,
  Euler,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Scene,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { DEFAULT_LOOK, sameLook, type KnifeLook } from '@world/shared';
import {
  FIST_POSE,
  HandRig,
  OPEN_POSE,
  FINGERS,
  FINGER_STRIDE,
  POINT_POSE,
  POSE_SIZE,
  THUMB_AT,
  GRIP_SLANT,
  gripPose,
  handPose,
  indexThrough,
  letGo,
  mixPose,
  placeHand,
  proximalAt,
  threadIndex,
  wristBend,
  type Grip,
  type HandPose,
  type Placement,
} from './hand.ts';
import {
  CHANNELS,
  LOWERED,
  SPENT,
  SWITCH,
  THROW,
  TURNS,
  clip,
  easeInCubic,
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  knifeMoves,
  sample,
  type ArmPose,
  type KnifeMoves,
  type Offset,
} from './knifeMoves.ts';
import { handKnifeMaterial, knifeModel, knifePartGeometry, type KnifeModel } from './knifeModel.ts';
import type { Joint, V2 } from './knifeShapes.ts';

/**
 * The player's own arm, in the style of a CS2 view model: a white chef's sleeve and a hand coming
 * up from the bottom right, holding a knife or empty. It sways behind the mouse, bobs with each
 * step, breathes, and plays the throw (wind up, snap, follow through, draw a fresh knife), the
 * switch between knife and bare hand, the bare hand's punch, and the knife's own draw, idle and
 * inspect, which each knife has its own of (knifeMoves.ts).
 *
 * It is drawn as a second pass, in its own scene, after clearing depth: it never clips into a wall,
 * and its parts still sort correctly against each other.
 */

export { SWITCH, THROW, type ArmPose };
/** How long the chef's knife's inspect lasts, in seconds. */
export const INSPECT = knifeMoves('kitchen').inspect.duration;
/** Punch timeline, in seconds from the press: a short draw back, the jab, and back to rest. */
export const PUNCH = { windUp: 0.05, hit: 0.13, recover: 0.42 } as const;
/**
 * An inspect, punch, flourish or idle cut short by a throw or a switch blends into it over this
 * long: done before the knife leaves the hand.
 */
const INTERRUPT_BLEND = 0.1;
/**
 * An inspect blends in over this long out of whatever it cuts short, another inspect included:
 * long enough that pressing I over and over never jolts the knife much harder than an inspect
 * itself does, short enough that every press visibly starts it over.
 */
const INSPECT_BLEND = 0.3;
/** How quickly the motion a cut carries on with dies away, per second. */
const CARRY = 10;

const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const smoothstep = (t: number): number => t * t * (3 - 2 * t);
/** The shorter way from `a` to `b`, for angles where a whole turn is the same as none. */
const turn = (a: number, b: number): number => {
  const d = a - b;
  return d - Math.PI * 2 * Math.round(d / (Math.PI * 2));
};

function set(
  out: ArmPose,
  x: number,
  y: number,
  z: number,
  rx: number,
  ry: number,
  rz: number,
): void {
  out.x = x;
  out.y = y;
  out.z = z;
  out.rx = rx;
  out.ry = ry;
  out.rz = rz;
}

/** The knife held still in the hand: not turned, its parts open. */
function still(out: ArmPose): void {
  out.spin = 0;
  out.flip = 0;
  out.a = 0;
  out.b = 0;
  out.hang = 0;
}

/**
 * The knife's own channels (its turns, parts and hang) blend over at least this long, in two
 * halves when it moves between the grip and the index finger: long enough for a knife cut short
 * mid-spin to settle upright before it comes back into the hand.
 */
const KNIFE_BLEND = 0.5;
/** Which way a cut takes the knife between the grip and the index finger, if either. */
type Travel = 'off' | 'on' | 'none';
const HANG_CHANNEL = CHANNELS.indexOf('hang');
const BLADE = CHANNELS.indexOf('a');
const HANDLE = CHANNELS.indexOf('b');
/** The first channel that moves the knife rather than the arm. */
const KNIFE_CHANNELS = CHANNELS.indexOf('spin');

/**
 * Blend `to` in, `t` seconds into a cut that lasts `duration`, out of where the arm was when cut
 * (`from`) carried on at the speed it was going (`speed`), dying away. The arm keeps its place and
 * its speed through the cut, so however often cuts come, it never jumps or jolts.
 *
 * The knife takes longer, and goes between the grip and the index finger only upright: leaving the
 * finger, it settles upright on it, then comes back into the hand; going onto the finger, it gets
 * there, then turns. A knife thrown or put away mid-spin goes from the finger. A knife on the finger
 * and headed back onto it stays on it, however the clip blended in gets there.
 */
function blend(
  from: ArmPose,
  speed: ArmPose,
  to: ArmPose,
  t: number,
  duration: number,
  travel: Travel,
  hangFloor: number,
): void {
  const carried = (1 - Math.exp(-CARRY * t)) / CARRY;
  const arm = 1 - smoothstep(clamp01(t / duration));
  const knife = Math.max(duration, KNIFE_BLEND);
  const whole = 1 - smoothstep(clamp01(t / knife));
  const first = 1 - smoothstep(clamp01((2 * t) / knife));
  const second = 1 - smoothstep(clamp01((2 * t) / knife - 1));
  const turns = travel === 'off' ? first : travel === 'on' ? second : whole;
  const hang = travel === 'off' ? second : travel === 'on' ? first : whole;
  for (let i = 0; i < CHANNELS.length; i++) {
    const c = CHANNELS[i]!;
    const k = i < KNIFE_CHANNELS ? arm : i === HANG_CHANNEL ? hang : turns;
    // A hinge stops at its stops: it is not carried on past them at the speed it was flicked.
    const on = i === BLADE || i === HANDLE ? 0 : speed[c] * carried;
    to[c] += (from[c] + on - to[c]) * k;
  }
  // Nor does it go back toward the grip further than either end of the cut has it.
  to.hang = Math.max(to.hang, hangFloor);
}

/**
 * Turn `from`'s angles by whole turns, which look the same, so that where the cut carries them on
 * to at `speed` is within half a turn of `aim`, where the cut is headed once blended: the knife goes
 * the shorter way there from where it coasts to, and is neither spun a whole turn round to reach a
 * pose it is already in nor whipped back to one it has spun past. Chosen once, as the cut is made,
 * so the way round cannot flip partway.
 */
function unwind(from: ArmPose, speed: Readonly<ArmPose>, aim: Readonly<ArmPose>): void {
  for (let i = 0; i < TURNS.length; i++) {
    const c = TURNS[i]!;
    const coast = speed[c] / CARRY;
    from[c] = aim[c] + turn(from[c] + coast, aim[c]) - coast;
  }
}

const KITCHEN = knifeMoves('kitchen');

/**
 * The arm `t` seconds into a throw: wind up, snap, follow through, then a fresh knife drawn up as
 * the knife in hand draws (`moves.redraw`).
 */
export function throwPose(t: number, out: ArmPose, moves: KnifeMoves = KITCHEN): ArmPose {
  still(out);
  out.knife = t < THROW.release || t >= THROW.drawFrom;
  if (t < THROW.windUp) {
    // Draw back past the ear, blade tipping back.
    const k = easeOutCubic(t / THROW.windUp);
    set(out, 0.03 * k, 0.07 * k, 0.1 * k, -0.75 * k, 0.15 * k, -0.1 * k);
  } else if (t < THROW.snap) {
    // The snap: fastest at the moment of release, through the middle of the view and down.
    const k = easeInOutCubic(clamp01((t - THROW.windUp) / (THROW.snap - THROW.windUp)));
    set(
      out,
      0.03 - 0.11 * k,
      0.07 - 0.1 * k,
      0.1 - 0.27 * k,
      -0.75 + 1.6 * k,
      0.15 - 0.35 * k,
      -0.1 + 0.25 * k,
    );
  } else if (t < THROW.followThrough) {
    // Follow through: the empty hand, extended, drops away out of view.
    const k = easeInCubic((t - THROW.snap) / (THROW.followThrough - THROW.snap));
    const e = SPENT;
    set(
      out,
      -0.08 + (e.x + 0.08) * k,
      -0.03 + (e.y + 0.03) * k,
      -0.17 + (e.z + 0.17) * k,
      0.85 + (e.rx - 0.85) * k,
      -0.2 + (e.ry + 0.2) * k,
      0.15 + (e.rz - 0.15) * k,
    );
  } else if (t < THROW.drawFrom) {
    set(out, SPENT.x, SPENT.y, SPENT.z, SPENT.rx, SPENT.ry, SPENT.rz);
  } else {
    // A fresh knife comes up from below, as this knife draws.
    sample(moves.redraw, t - THROW.drawFrom, out);
  }
  return out;
}

/** The arm `t` seconds into a switch: lowering what was held, then raising the other. */
export function switchPose(t: number, out: ArmPose): ArmPose {
  still(out);
  out.knife = true;
  if (t < SWITCH.lower) {
    const k = easeInCubic(t / SWITCH.lower);
    set(out, 0, LOWERED.y * k, 0, LOWERED.rx * k, 0, 0);
  } else {
    const k = easeOutBack(clamp01((t - SWITCH.lower) / (SWITCH.raise - SWITCH.lower)));
    set(out, 0, LOWERED.y * (1 - k), 0, LOWERED.rx * (1 - k), 0, 0);
  }
  return out;
}

/**
 * Where a switch starts, `since` seconds into the last one: from the start once that one is done,
 * but from the arm's height now if it is still under way, so switching back never jumps the arm. On
 * the way down, what is in hand comes back up from there; on the way up, it goes back down.
 */
export function switchFrom(since: number): number {
  if (since >= SWITCH.raise) return 0;
  const raising = SWITCH.raise - SWITCH.lower;
  if (since < SWITCH.lower) {
    // Lowered by easeInCubic; find where the raise, 1 - easeOutBack, is first that low.
    const lowered = easeInCubic(since / SWITCH.lower);
    let k = 0;
    while (k < 1 && 1 - easeOutBack(k) > lowered) k += 1 / 512;
    return SWITCH.lower + Math.min(1, k) * raising;
  }
  const lowered = Math.max(0, 1 - easeOutBack((since - SWITCH.lower) / raising));
  return SWITCH.lower * Math.cbrt(lowered);
}

/** The bare hand's jab: drawn back a touch, then straight out toward the crosshair and home. */
const PUNCH_CLIP = clip([
  { t: 0 },
  { t: PUNCH.windUp, x: 0.01, y: -0.01, z: 0.03, rx: 0.1 },
  { t: PUNCH.hit, x: -0.075, y: 0.05, z: -0.1, rx: -0.2, ry: -0.12, rz: -0.15 },
  { t: PUNCH.recover, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
]);

/** The arm `t` seconds into inspecting the chef's knife. */
export function knifeInspectPose(t: number, out: ArmPose): ArmPose {
  return sample(KITCHEN.inspect, t, out);
}

/** The arm `t` seconds into a punch. */
export function punchPose(t: number, out: ArmPose): ArmPose {
  return sample(PUNCH_CLIP, t, out);
}

/** Where the hand rests in view: low and to the right. */
const REST = new Vector3(0.17, -0.19, -0.36);
/** The forearm runs back and down to the bottom right corner, out of view. */
const REST_ROTATION = new Euler(0.55, 0.45, 0.12, 'YXZ');
/** The knife stands up out of the fist, leaning forward. */
const BLADE_UP = new Vector3(0, 0.82, -0.57).normalize();
const KNIFE_SIZE = 0.78;
/** The whole arm, hand and knife, scaled to sit in view the way a CS2 view model does. */
const ARM_SCALE = 0.72;

/** How the fist turns the chef's knife: its tip along BLADE_UP, its spine toward the eye. */
const CHEF_HOLD = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), BLADE_UP);
/**
 * A basis for the fist from where, seen at rest, the tip points and the spine faces, in camera space
 * (x right, y up, -z ahead): easier to judge by eye than in the arm's own turned frame.
 */
function holdFromView(tip: Vector3, spine: Vector3): Quaternion {
  const toArm = new Quaternion().setFromEuler(REST_ROTATION).invert();
  const back = tip.normalize().applyQuaternion(toArm).negate();
  const up = spine.applyQuaternion(toArm);
  up.sub(back.clone().multiplyScalar(up.dot(back))).normalize();
  const side = new Vector3().crossVectors(up, back);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(side, up, back));
}

/**
 * A karambit's grip: the ring on the finger over the fist and the claw curling out of its heel
 * toward the middle of the view, the flat of the blade to the eye.
 */
const REVERSE_HOLD = holdFromView(new Vector3(-0.5, -0.85, -0.2), new Vector3(1, 0, 0));

const HOLDS: Readonly<Record<KnifeModel['hold'], Quaternion>> = {
  chef: CHEF_HOLD,
  // Up and toward the middle of the view, the flat of the blade to the eye and the edge inward.
  forward: holdFromView(new Vector3(-0.3, 0.9, -0.3), new Vector3(1, 0, 0.4)),
  reverse: REVERSE_HOLD,
};

const NO_OFFSET: Readonly<Offset> = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };

const X_AXIS = new Vector3(1, 0, 0);
const Z_AXIS = new Vector3(0, 0, 1);
/** The forearm, from the elbow toward the hand, in the arm's own frame. */
const FOREARM = new Vector3(0, 0, -1);
/** The bare hand: palm down, its wrist just inside the cuff. */
const BARE_WRIST = new Vector3(0, 0, 0.045);
const BARE_TURN = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
const NO_TURN = new Quaternion();
/** The sleeve and its cuff end at the wrist, wherever a grip puts it. */
const CUFF_FROM_WRIST = 0.0195;
const SLEEVE_FROM_WRIST = 0.1925;
/**
 * How much of the turn from the forearm to the hand the forearm takes itself (as the elbow moves to
 * suit a grip), leaving the rest to the wrist.
 */
const FOREARM_FOLLOWS = 0.5;

/** How a knife sits in the hand. */
export interface KnifeHand {
  /** The fingers round its handle. */
  readonly grip: Grip;
  /** The hand opened from that grip to let the handle go. */
  readonly open: HandPose;
  /** Where the wrist goes for that grip, in the arm's frame. */
  readonly placement: Placement;
  /**
   * The hand round the handle while the knife is turned about its length in it: each finger round
   * the widest its part of the handle gets as it turns, and the hand set back to suit. The same as
   * the grip for a knife never turned in the hand (a karambit on its ring).
   */
  readonly turning: { readonly grip: Grip; readonly placement: Placement };
  /** Spun on the index finger through a ring (karambit, talon, skeleton). */
  readonly ringed: boolean;
  /** Its ring is on the index finger in the grip too, not only when spun (karambit). */
  readonly threaded: boolean;
  /** How far along the index finger's proximal phalanx a threaded ring sits in the grip. */
  readonly along: number;
  /**
   * What it hangs from on the index finger, and turns end over end about, in model space: the
   * middle of its ring, or beside its spine above the grip, a finger's thickness off it.
   */
  readonly pivot: Vector3;
  /** Its handle's thickness where it is held, in the arm's frame. */
  readonly radius: number;
  /** How the forearm turns, at the wrist, toward the hand in this grip. */
  readonly forearm: Quaternion;
}

/**
 * A knife's handle across `z` (model space), from the side outlines of the parts there: how thick
 * it is, between its depth and its thinner width since the fingers wrap both; its middle from
 * spine to edge; and half its depth and width.
 */
export function handleAt(
  model: KnifeModel,
  z: number,
): { radius: number; y: number; depth: number; width: number } {
  let y0 = Infinity;
  let y1 = -Infinity;
  let width = 0;
  for (const part of model.parts) {
    let crossed = false;
    for (const loop of part.outline) {
      if (loop.hole) continue;
      const points = loop.points;
      for (let i = 0; i < points.length; i++) {
        const [za, ya] = points[i]!;
        const [zb, yb] = points[(i + 1) % points.length]!;
        if ((za - z) * (zb - z) > 0 || za === zb) continue;
        const y = ya + ((z - za) * (yb - ya)) / (zb - za);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
        crossed = true;
      }
    }
    if (!crossed) continue;
    const p = part.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) width = Math.max(width, Math.abs(p.getX(i)));
  }
  const depth = (y1 - y0) / 2;
  return { radius: 0.6 * depth + 0.4 * width, y: (y0 + y1) / 2, depth, width };
}

const knifeHands = new Map<KnifeModel['skin'], KnifeHand>();

/** How far a ring's hole may lean off the finger through it and still let the finger through. */
const RING_TILT = 0.6;
/** How far a spun knife's spine keeps off the finger it turns round, in the arm's units. */
const SPINE_GAP = 0.001;
/**
 * Where on the index finger's proximal phalanx a spun knife hangs, as a share of its length from
 * the knuckle: out past the fist the other fingers fold into, so the knife turns clear of them.
 */
const HANG_ALONG = 0.88;
/**
 * A knife on its way from the grip to the index finger, by how far along it is (`hang`): it stays
 * put while the hand opens, by `open`; swings out from the palm (as far as `lift`) and round to the
 * finger's line, `ahead` of where it hangs, by `round`, while the other fingers fold into a fist
 * behind it (from `fold` to `folded`, the thumb from `thumb` to `thumbFolded`); and comes onto
 * the finger along it (in the arm's units). A
 * ring already on the finger turns the handle out of the fist by `round`, and the fingers fold
 * after it, by `threadFolded`.
 */
const HANG = {
  open: 0.15,
  fold: 0.2,
  folded: 0.45,
  thumb: 0.35,
  thumbFolded: 0.6,
  round: 0.6,
  threadFolded: 0.9,
  lift: 0.06,
  ahead: 0.075,
} as const;

/**
 * A karambit's grip. The middle, ring and little fingers wrap the handle; the index finger, past
 * the handle's end, goes through the ring instead, bent at the knuckle to aim through it. So the
 * ring sets how far the index finger curls, and the hand is free to turn about the handle: it turns
 * whichever way bends the wrist least of those that bring the ring within the index finger's
 * reach, its hole lined up near enough with the finger.
 */
function threadRing(
  grip: Grip,
  axis: Vector3,
  point: Vector3,
  ring: Vector3,
  hole: Vector3,
): { grip: Grip; placement: Placement; along: number } | null {
  const index = FINGERS[0]!;
  const toHand = new Quaternion();
  const local = new Vector3();
  let best: { placement: Placement; local: Vector3; bend: number; along: number } | null = null;
  for (let i = 0; i < 360; i++) {
    const turn = (i / 360) * Math.PI * 2;
    const placement = placeHand(grip.axis, grip.center, axis, point, FOREARM, turn);
    toHand.copy(placement.quaternion).invert();
    local.copy(ring).sub(placement.position).applyQuaternion(toHand);
    // Slide the hand along the handle until the ring is in the index finger's plane.
    const slide = (local.y - index.base[1]) / grip.axis.y;
    placement.position.addScaledVector(axis, slide);
    local.addScaledVector(grip.axis, -slide);
    const through = indexThrough(local);
    if (!through) continue;
    const finger = new Vector3(local.x - index.base[0], 0, local.z - index.base[2]).normalize();
    const lean = Math.abs(finger.dot(hole.clone().applyQuaternion(toHand)));
    if (lean < Math.cos(RING_TILT)) continue;
    const bend = wristBend(placement, FOREARM);
    if (!best || bend < best.bend) {
      best = { placement, local: local.clone(), bend, along: through.along };
    }
  }
  return (
    best && {
      grip: threadIndex(grip, best.local),
      placement: best.placement,
      along: best.along,
    }
  );
}

/** The shortest way from a point to a segment, in side view. */
function toSegment(z: number, y: number, [za, ya]: V2, [zb, yb]: V2): number {
  const dz = zb - za;
  const dy = yb - ya;
  const length = dz * dz + dy * dy;
  const t = length > 0 ? clamp01(((z - za) * dz + (y - ya) * dy) / length) : 0;
  return Math.hypot(z - za - dz * t, y - ya - dy * t);
}

/**
 * Where a knife without a ring turns about the index finger when spun (model space): above its
 * spine at `z`, as far as a finger of `radius` takes to lie along it clear of every part, so the
 * knife can turn round the finger with its spine against it.
 */
function spinePivot(model: KnifeModel, z: number, radius: number): Vector3 {
  const clear = (y: number): boolean => {
    for (const part of model.parts) {
      for (const loop of part.outline) {
        const points = loop.points;
        for (let i = 0; i < points.length; i++) {
          if (toSegment(z, y, points[i]!, points[(i + 1) % points.length]!) < radius) return false;
        }
      }
    }
    return true;
  };
  // From the spine up: a deep handle's middle may be as far from its edges, but inside it.
  const section = handleAt(model, z);
  let y = section.y + section.depth;
  while (!clear(y)) y += radius / 50;
  return new Vector3(0, y, z);
}

/**
 * The grip a knife turned about its length needs: each finger wrapped round the circle about the
 * handle's axis that holds the handle across the finger's width, however it is turned (an index
 * finger by a guard clears the guard), and the handle that much further off the palm as its widest
 * under the other fingers needs.
 */
function turningGrip(
  model: KnifeModel,
  grip: Grip,
  axis: Vector3,
  point: Vector3,
): { grip: Grip; placement: Placement } {
  const [gz] = model.grip;
  const middle = handleAt(model, gz).y;
  const along = model.hold === 'reverse' ? 1 : -1;
  const radii = FINGERS.map((finger) => {
    // Where the handle's axis crosses this finger's plane, along the knife from the grip, and the
    // handle across the finger's width there, a guard beside it included.
    const s = (finger.base[1] - grip.center.y) / grip.axis.y;
    let widest = grip.radius;
    for (let k = -2; k <= 2; k++) {
      const z = gz + (along * (s + (k / 2) * finger.radius)) / KNIFE_SIZE;
      const section = handleAt(model, z);
      const reach = Math.abs(section.y - middle) + section.depth;
      widest = Math.max(widest, Math.hypot(section.width, reach) * KNIFE_SIZE);
    }
    return widest;
  });
  const roomy = gripPose(Math.max(...radii.slice(1)), GRIP_SLANT, radii);
  return { grip: roomy, placement: placeHand(roomy.axis, roomy.center, axis, point, FOREARM) };
}

/**
 * The hand round a knife's handle, turned to carry on from the forearm. A karambit's ring threads
 * the index finger (threadRing), so the knife spins round the finger; every other knife, held by
 * its handle, moves when spun onto the index finger to turn about it: by its ring, or by its spine.
 */
export function knifeHand(model: KnifeModel): KnifeHand {
  const known = knifeHands.get(model.skin);
  if (known) return known;
  const hold = HOLDS[model.hold];
  const [gz, gy] = model.grip;
  const [pz, py] = model.pivot;
  // A point of the knife (model space) in the arm's frame, as the holder holds it at rest.
  const toArm = (y: number, z: number): Vector3 =>
    new Vector3(0, y - gy, z - gz).multiplyScalar(KNIFE_SIZE).applyQuaternion(hold);
  const section = handleAt(model, gz);
  const radius = section.radius * KNIFE_SIZE;
  const point = toArm(section.y, gz);
  const reverse = model.hold === 'reverse';
  // The handle's axis through the hand runs toward the index finger: toward the tip in a forward
  // grip, toward the butt (and the ring) in a reverse one.
  const axis = new Vector3(0, 0, reverse ? 1 : -1).applyQuaternion(hold);
  const ringed = pz !== gz || py !== gy;
  let grip = gripPose(radius);
  let placement = placeHand(grip.axis, grip.center, axis, point, FOREARM);
  let threaded = false;
  let along = HANG_ALONG;
  if (reverse) {
    const ring = threadRing(grip, axis, point, toArm(py, pz), X_AXIS.clone().applyQuaternion(hold));
    if (ring) ({ grip, placement, along } = ring);
    threaded = ring !== null;
  }
  const pivot = ringed
    ? new Vector3(0, py, pz)
    : spinePivot(model, gz, (FINGERS[0]!.radius + SPINE_GAP) / KNIFE_SIZE);
  const reach = new Vector3(0, 0, -1).applyQuaternion(placement.quaternion);
  const forearm = new Quaternion()
    .identity()
    .slerp(new Quaternion().setFromUnitVectors(FOREARM, reach), FOREARM_FOLLOWS);
  const open = letGo(grip);
  const turning = threaded ? { grip, placement } : turningGrip(model, grip, axis, point);
  const hand = { grip, open, placement, turning, ringed, threaded, along, pivot, radius, forearm };
  knifeHands.set(model.skin, hand);
  return hand;
}

const SLEEVE = '#f2f0e9';
const CUFF = '#dedad0';

export class Viewmodel {
  readonly scene = new Scene();
  private readonly root = new Group();
  private readonly arm = new Group();
  private readonly sleeve: Mesh;
  private readonly cuff: Mesh;
  /** The one hand, round the knife or bare. */
  private readonly hand: HandRig;
  /** How the held knife sits in it. */
  private knifeHand!: KnifeHand;
  /** The hand's pose this frame. */
  private readonly handPose = handPose();
  /** Whether the hand is round the knife (or bare) this frame. */
  private gripping = true;
  /** How far the bare hand is curled into a fist: 0 open, 1 clenched. */
  private curl = 0;
  /** How far the fingers have let go of the knife's handle while it spins or hangs: 0 to 1. */
  private release = 0;
  private lastFlip = 0;
  private readonly bareTilt = new Euler();
  private readonly flipTurn = new Quaternion();
  private readonly spinTurn = new Quaternion();
  /**
   * Where the knife hangs on the index finger this frame, the finger's line, and how the knife
   * turns to hang there, in the holder's space; and which way along that line the fingertip is.
   */
  private readonly hangAt = new Vector3();
  private readonly hangAxis = new Vector3();
  private readonly hangTurn = new Quaternion();
  private hangSide = 1;
  /** Out from the palm, and in front of the fingertip, on the knife's way to the finger. */
  private readonly palmOut = new Vector3();
  private readonly aheadAt = new Vector3();
  /** The knife's pivot where it is held, turned about its length with it. */
  private readonly heldAt = new Vector3();
  /** From the arm's frame into the knife holder's turn. */
  private readonly toHolder = new Quaternion();
  /** The frame's time step, for what eases inside apply. */
  private frameDt = 0;
  /**
   * The knife: held at the grip; inside the holder, turned about its length and end over end about
   * its pivot, which moves onto the index finger as it hangs there.
   */
  private readonly knifeHolder = new Group();
  private readonly flipper = new Group();
  private readonly model = new Group();
  /** The knife's moving parts, each turned by a pose channel. */
  private joints: { readonly group: Group; readonly joint: Joint }[] = [];
  private current: KnifeModel = knifeModel(DEFAULT_LOOK.skin);
  /** From the grip to the pivot, in the knife's space. */
  private readonly toPivot = new Vector3();
  private currentLook: KnifeLook = DEFAULT_LOOK;
  private moves: KnifeMoves = KITCHEN;
  private readonly skin = new MeshStandardMaterial({
    color: '#ff7a59',
    roughness: 0.7,
    flatShading: true,
  });

  /** Lit like the kitchen around it; see matchLighting. */
  private readonly fill = new HemisphereLight('#f5f8fc', '#d6d2ca', 1.9);
  private readonly key = new DirectionalLight('#fffaf2', 1.7);
  private shown = false;
  /** What the player asked to hold, and what the hand holds right now (they differ mid-switch). */
  private armed = true;
  private holding: 'knife' | 'hand' = 'knife';
  private sinceThrow = Infinity;
  private sinceSwitch = Infinity;
  private sinceInspect = Infinity;
  private sincePunch = Infinity;
  private sinceInterrupt = Infinity;
  /** How long the blend out of the last cut lasts. */
  private interruptBlend = INTERRUPT_BLEND;
  /** The draw's flourish was cut short: the arm stops playing it, though the knife is up no sooner. */
  private drawCut = false;
  /** How long the knife has rested in hand with nothing going on: the idle plays on this. */
  private idleTime = 0;
  private time = 0;

  // Sway, bob and breathing state.
  private lastYaw = 0;
  private lastPitch = 0;
  private swayX = 0;
  private swayY = 0;
  private swayVX = 0;
  private swayVY = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private air = 0;

  private readonly pose: ArmPose = {
    x: 0,
    y: 0,
    z: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    knife: true,
    spin: 0,
    flip: 0,
    a: 0,
    b: 0,
    hang: 0,
  };
  /** The pose last frame, and how fast each of its channels is changing, per second. */
  private readonly lastPose: ArmPose = { ...this.pose };
  private readonly poseSpeed: ArmPose = { ...this.pose };
  /** Where the arm was when last cut short, and how fast it was going; blended away from. */
  private readonly interrupted: ArmPose = { ...this.pose };
  private readonly interruptedSpeed: ArmPose = { ...this.pose };
  /** Which way the last cut takes the knife, off the index finger or onto it, and how far. */
  private travel: Travel = 'none';
  private hangFloor = 0;
  /** Where the last cut is headed once blended, and whether that is still to be worked out. */
  private readonly cutAim: ArmPose = { ...this.pose };
  private aiming = false;
  private readonly euler = new Euler(0, 0, 0, 'YXZ');

  constructor() {
    const sleeveMaterial = new MeshStandardMaterial({
      color: SLEEVE,
      roughness: 0.9,
      flatShading: true,
    });
    const cuffMaterial = new MeshStandardMaterial({
      color: CUFF,
      roughness: 0.9,
      flatShading: true,
    });
    // The forearm runs along +Z, from the wrist back toward the elbow.
    this.sleeve = new Mesh(
      new CylinderGeometry(0.036, 0.05, 0.36, 8).rotateX(Math.PI / 2),
      sleeveMaterial,
    );
    this.cuff = new Mesh(
      new CylinderGeometry(0.041, 0.041, 0.035, 8).rotateX(Math.PI / 2),
      cuffMaterial,
    );
    this.hand = new HandRig(this.skin);

    // The knife, gripped in the fist. The holder turns it to the grip; the rest animate it.
    this.knifeHolder.scale.setScalar(KNIFE_SIZE);
    this.knifeHolder.add(this.flipper);
    this.flipper.add(this.model);
    this.build(DEFAULT_LOOK);

    this.arm.add(this.sleeve, this.cuff, this.hand.mesh, this.knifeHolder);
    this.arm.scale.setScalar(ARM_SCALE);
    this.root.add(this.arm);
    this.key.position.set(5, 13, 9);
    this.scene.add(this.fill, this.key, this.root);
    this.apply();
  }

  /**
   * Light the arm like the room it is in: in the evening kitchen of the high tier, a warm key from
   * the lamps over a low, cool fill, instead of the bright even daylight of the low tier.
   */
  matchLighting(evening: boolean, environment: Texture | null, environmentIntensity: number): void {
    // The blade reflects the same kitchen as everything else in it.
    this.scene.environment = environment;
    this.scene.environmentIntensity = environmentIntensity;
    if (!evening) return;
    this.fill.color.set('#7d90b0');
    this.fill.groundColor.set('#6f5a4b');
    this.fill.intensity = 0.8;
    this.key.color.set('#ffd6a8');
    this.key.intensity = 1.5;
    this.key.position.set(2, 8, 5);
  }

  /** The hand takes the player's color, like their cook's hands. */
  setColor(color: string): void {
    this.skin.color.set(new Color(color));
  }

  /** The knife the player carries. A new one is drawn the next time the arm comes into view. */
  setLook(look: KnifeLook): void {
    if (sameLook(look, this.currentLook)) return;
    this.interrupt();
    this.sinceInspect = Infinity;
    this.build(look);
    // Whatever was going on belonged to the last knife; draw this one fresh.
    if (this.armed) {
      this.sinceSwitch = SWITCH.lower;
      this.drawCut = false;
    }
    this.jump();
  }

  get look(): KnifeLook {
    return this.currentLook;
  }

  /** Put a knife's parts in the hand, each moving part in its own hinge. */
  private build(look: KnifeLook): void {
    for (const child of [...this.model.children]) this.model.remove(child);
    this.joints = [];
    const model = knifeModel(look.skin);
    this.current = model;
    this.currentLook = look;
    this.moves = knifeMoves(look.skin);
    const hinges = new Map<string, Group>();
    const hingeFor = (joint: Joint): Group => {
      const existing = hinges.get(`${joint.channel}:${joint.parent ?? ''}`);
      if (existing) return existing;
      const parentPart = joint.parent ? model.parts.find((p) => p.name === joint.parent) : null;
      const parent = parentPart?.joint ? hingeFor(parentPart.joint) : this.model;
      // Turn about the pivot, then put the part back in model space inside it.
      const hinge = new Group();
      hinge.position.set(0, joint.pivot[1], joint.pivot[0]);
      const inner = new Group();
      inner.position.set(0, -joint.pivot[1], -joint.pivot[0]);
      hinge.add(inner);
      parent.add(hinge);
      hinges.set(`${joint.channel}:${joint.parent ?? ''}`, inner);
      this.joints.push({ group: hinge, joint });
      return inner;
    };
    for (const part of model.parts) {
      const mesh = new Mesh(knifePartGeometry(look, part), handKnifeMaterial());
      const parent: Object3D = part.joint ? hingeFor(part.joint) : this.model;
      parent.add(mesh);
    }
    this.knifeHolder.quaternion.copy(HOLDS[model.hold]);
    this.toHolder.copy(HOLDS[model.hold]).invert();
    this.knifeHand = knifeHand(model);
    this.release = 0;
    this.lastFlip = 0;
    // The grip at the holder's origin; turned end over end about the pivot.
    const [gz, gy] = model.grip;
    const { pivot } = this.knifeHand;
    this.toPivot.set(0, pivot.y - gy, pivot.z - gz);
    this.flipper.position.copy(this.toPivot);
    this.model.position.set(0, -pivot.y, -pivot.z);
  }

  /** Whether the arm is in view at all (in the world and standing). */
  setShown(shown: boolean): void {
    if (shown && !this.shown) {
      // Back in view: whatever is held comes up fresh.
      this.sinceThrow = Infinity;
      this.sinceSwitch = SWITCH.lower;
      this.drawCut = false;
      this.sinceInspect = Infinity;
      this.sincePunch = Infinity;
      this.sinceInterrupt = Infinity;
      this.idleTime = 0;
      this.curl = 0;
      this.holding = this.armed ? 'knife' : 'hand';
      this.jump();
    }
    this.shown = shown;
  }

  get isShown(): boolean {
    return this.shown;
  }

  /** Hold the knife (true) or the bare hand (false). Switching plays the lower-and-raise. */
  setArmed(armed: boolean): void {
    if (armed === this.armed) return;
    // Switching back mid-switch picks up from the arm's height (switchFrom); the blend smooths the
    // rest, the raise's overshoot above rest included.
    this.interrupt(INTERRUPT_BLEND, this.sinceSwitch < SWITCH.raise);
    this.armed = armed;
    this.sinceThrow = Infinity;
    this.sinceSwitch = switchFrom(this.sinceSwitch);
    this.drawCut = false;
  }

  /** Ready to throw: the knife is in hand, up, and no throw or switch is under way. */
  get canThrow(): boolean {
    return this.armed && this.holding === 'knife' && this.idle;
  }

  /**
   * Start the throw animation, cutting an inspect or a flourish short. The caller launches the knife
   * THROW.release seconds later.
   */
  startThrow(): boolean {
    if (!this.canThrow) return false;
    this.interrupt();
    this.sinceThrow = 0;
    return true;
  }

  /** How far the next knife is from ready: 0 just after letting go, 1 once it is drawn and up. */
  get knifeReadiness(): number {
    // Until the hand lets go, the knife is still in it.
    if (this.sinceThrow < THROW.release) return 1;
    return clamp01((this.sinceThrow - THROW.release) / (THROW.drawTo - THROW.release));
  }

  /** Mid-inspect. */
  get inspecting(): boolean {
    return this.sinceInspect < this.moves.inspect.duration;
  }

  /** How far into its inspect the knife is, in seconds, or null if it is not being inspected. */
  get inspectTime(): number | null {
    return this.inspecting ? this.sinceInspect : null;
  }

  /**
   * Take a long look at the knife, if it is in hand: not thrown, nor put away. As in CS2, every
   * press starts the inspect over, even mid-inspect, and it may cut the draw short the moment the
   * knife is in the hand, though it can be thrown only once it is all the way up.
   */
  startInspect(): boolean {
    if (!this.knifeInHand) return false;
    this.interrupt(INSPECT_BLEND);
    this.sinceInspect = 0;
    return true;
  }

  /** The knife is in the hand in view, if still coming up: not thrown, nor on its way down. */
  private get knifeInHand(): boolean {
    return (
      this.shown &&
      this.armed &&
      this.holding === 'knife' &&
      this.sinceSwitch >= SWITCH.lower &&
      this.sinceThrow >= THROW.drawTo
    );
  }

  /** Mid-punch. */
  get punching(): boolean {
    return this.sincePunch < PUNCH.recover;
  }

  /** How far the bare hand is curled into a fist: 0 open, 1 clenched. */
  get handCurl(): number {
    return this.curl;
  }

  /** Jab with the bare hand, if it is up and not already punching. */
  startPunch(): boolean {
    if (!this.shown || this.armed || this.holding !== 'hand' || this.punching || !this.idle) {
      return false;
    }
    this.sincePunch = 0;
    this.sinceInterrupt = Infinity;
    return true;
  }

  /** Nothing in progress: whatever is in hand is up, and not being thrown or switched. */
  private get idle(): boolean {
    const raised =
      this.sinceSwitch >= SWITCH.raise && this.holding === (this.armed ? 'knife' : 'hand');
    return raised && (this.holding === 'hand' || this.sinceThrow >= THROW.drawTo);
  }

  /**
   * The knife's draw still playing out: an inspect may cut it short as soon as the knife is in the
   * hand, and anything once the knife is up, when what is left of it is its flourish.
   */
  private get flourishing(): boolean {
    return (
      this.holding === 'knife' &&
      !this.drawCut &&
      this.sinceSwitch < SWITCH.lower + this.moves.draw.duration
    );
  }

  /** At rest with the knife up, playing its idle. */
  private get idling(): boolean {
    return (
      this.holding === 'knife' &&
      this.idle &&
      !this.flourishing &&
      !this.inspecting &&
      this.moves.idle.duration > 0
    );
  }

  /**
   * Cut an inspect, a punch, a flourish or the idle short, blending over `duration` out of wherever
   * the arm was, at the speed it was going, into what follows; `aim` is where that has the knife's
   * turns once blended in.
   */
  private interrupt(duration = INTERRUPT_BLEND, always = false): void {
    const flourish = this.flourishing && this.sinceSwitch >= SWITCH.lower;
    const busy = this.inspecting || this.punching || flourish || (this.idling && this.idleTime > 0);
    if (!busy && !always) return;
    Object.assign(this.interrupted, this.pose);
    Object.assign(this.interruptedSpeed, this.poseSpeed);
    this.sinceInspect = Infinity;
    this.sincePunch = Infinity;
    if (flourish) this.drawCut = true;
    this.idleTime = 0;
    this.sinceInterrupt = 0;
    this.interruptBlend = duration;
    // What follows is set up after this; the next frame aims at it.
    this.aiming = true;
  }

  /**
   * Where the cut just made is headed, once whatever follows has been set up: the arm `duration`
   * on, as nothing else is pressed. The knife's turns unwind toward it, and it decides once, so it
   * cannot change partway, whether the knife goes off the index finger or onto it.
   */
  private aimCut(): void {
    this.aiming = false;
    const aim = this.poseAhead(this.interruptBlend, this.cutAim);
    unwind(this.interrupted, this.interruptedSpeed, aim);
    const from = clamp01(this.interrupted.hang);
    const to = clamp01(aim.hang);
    this.travel = from - to > 0.01 ? 'off' : to - from > 0.01 ? 'on' : 'none';
    this.hangFloor = Math.min(from, to);
  }

  /** The arm `ahead` seconds from now if nothing else is pressed. */
  private poseAhead(ahead: number, out: ArmPose): ArmPose {
    const { sinceInspect, sincePunch, sinceSwitch, sinceThrow, idleTime, holding } = this;
    this.sinceInspect += ahead;
    this.sincePunch += ahead;
    this.sinceSwitch += ahead;
    this.sinceThrow += ahead;
    this.idleTime += ahead;
    if (this.sinceSwitch >= SWITCH.lower) this.holding = this.armed ? 'knife' : 'hand';
    this.poseNow(out);
    this.sinceInspect = sinceInspect;
    this.sincePunch = sincePunch;
    this.sinceSwitch = sinceSwitch;
    this.sinceThrow = sinceThrow;
    this.idleTime = idleTime;
    this.holding = holding;
    return out;
  }

  /** The knife's middle in the world right now, where a knife leaving the hand starts from. */
  knifeCenter(out: Vector3): Vector3 {
    this.root.updateMatrixWorld(true);
    const [cz, cy] = this.current.center;
    return this.model.localToWorld(out.set(0, cy, cz));
  }

  /** Follow the camera and animate. `speed` and `grounded` drive the walk bob. */
  update(
    dt: number,
    camera: PerspectiveCamera,
    yaw: number,
    pitch: number,
    speed: number,
    grounded: boolean,
  ): void {
    this.time += dt;
    this.sinceThrow += dt;
    this.sinceSwitch += dt;
    this.sinceInspect += dt;
    this.sincePunch += dt;
    this.sinceInterrupt += dt;
    this.idleTime = this.idling ? this.idleTime + dt : 0;
    // The hand clenches quickly for the jab and opens again more slowly once it is on the way back;
    // easing toward the target means it can never snap, even mid-punch or when punches overlap.
    const clench = this.sincePunch < PUNCH.hit + 0.1 ? 1 : 0;
    const rate = clench > this.curl ? 45 : 9;
    this.curl += (clench - this.curl) * (1 - Math.exp(-dt * rate));
    if (this.sinceSwitch >= SWITCH.lower) this.holding = this.armed ? 'knife' : 'hand';
    this.frameDt = dt;
    this.root.position.copy(camera.position);
    this.root.quaternion.copy(camera.quaternion);

    // Sway: the arm lags behind the look and springs back, like a weight in the hand.
    if (dt > 0) {
      let dYaw = yaw - this.lastYaw;
      dYaw -= Math.PI * 2 * Math.round(dYaw / (Math.PI * 2));
      const dPitch = pitch - this.lastPitch;
      const targetX = Math.max(-0.035, Math.min(0.035, (dYaw / dt) * 0.006));
      const targetY = Math.max(-0.03, Math.min(0.03, (-dPitch / dt) * 0.006));
      const stiffness = 160;
      const damping = 2 * Math.sqrt(stiffness) * 0.85;
      this.swayVX += ((targetX - this.swayX) * stiffness - this.swayVX * damping) * dt;
      this.swayVY += ((targetY - this.swayY) * stiffness - this.swayVY * damping) * dt;
      this.swayX += this.swayVX * dt;
      this.swayY += this.swayVY * dt;
    }
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    // Walk bob: a figure eight, stronger when sprinting.
    const walking = grounded && speed > 0.5;
    this.bobAmount +=
      ((walking ? Math.min(1.4, speed / 5) : 0) - this.bobAmount) * Math.min(1, dt * 8);
    if (walking) this.bobPhase += dt * (4.5 + speed * 0.9);
    this.air += ((grounded ? 0 : 1) - this.air) * Math.min(1, dt * 10);
    Object.assign(this.lastPose, this.pose);
    this.apply();
    this.trackSpeed(dt);
  }

  /**
   * The arm was put somewhere new on purpose: pose it there at once, and still, so that a cut
   * before the next frame starts from where it now is, and carries no speed from where it was.
   */
  private jump(): void {
    // Put there at once: no time passes, so nothing that eases (the fingers' grip) moves on.
    this.frameDt = 0;
    this.apply();
    for (let i = 0; i < CHANNELS.length; i++) this.poseSpeed[CHANNELS[i]!] = 0;
  }

  /** How fast the pose is changing, for a cut to carry on with. */
  private trackSpeed(dt: number): void {
    if (dt <= 0) return;
    for (let i = 0; i < CHANNELS.length; i++) {
      const c = CHANNELS[i]!;
      // A whole turn looks the same as none, and a clip unwinds its turns as it ends.
      const d = TURNS.includes(c)
        ? turn(this.pose[c], this.lastPose[c])
        : this.pose[c] - this.lastPose[c];
      this.poseSpeed[c] = d / dt;
    }
  }

  /** Draw the arm over the world. */
  render(renderer: WebGLRenderer, camera: PerspectiveCamera): void {
    if (!this.shown) return;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, camera);
    renderer.autoClear = true;
  }

  /** The arm's pose this frame: whatever is going on, as the held knife does it. */
  private poseNow(pose: ArmPose): void {
    const moves = this.moves;
    if (this.inspecting) sample(moves.inspect, this.sinceInspect, pose);
    else if (this.punching) punchPose(this.sincePunch, pose);
    else if (this.sinceSwitch < SWITCH.lower) switchPose(this.sinceSwitch, pose);
    else if (this.holding === 'knife' && this.flourishing)
      sample(moves.draw, this.sinceSwitch - SWITCH.lower, pose);
    else if (this.holding === 'hand') switchPose(Math.min(this.sinceSwitch, SWITCH.raise), pose);
    else if (this.sinceThrow < THROW.drawTo) throwPose(this.sinceThrow, pose, moves);
    else if (this.idling) sample(moves.idle, this.idleTime % moves.idle.duration, pose);
    else throwPose(THROW.drawTo, pose, moves);
  }

  private apply(): void {
    const pose = this.pose;
    this.poseNow(pose);
    if (this.aiming) this.aimCut();
    if (this.sinceInterrupt < Math.max(this.interruptBlend, KNIFE_BLEND)) {
      blend(
        this.interrupted,
        this.interruptedSpeed,
        pose,
        this.sinceInterrupt,
        this.interruptBlend,
        this.travel,
        this.hangFloor,
      );
    }
    const knife = this.holding === 'knife' && pose.knife;
    this.knifeHolder.visible = knife;
    this.gripping = this.holding === 'knife';
    this.poseHand(pose, knife);
    this.placeKnife(pose);

    // The held knife's own resting place; the pose itself stays relative to it.
    const rest = this.holding === 'knife' ? this.moves.rest : NO_OFFSET;

    const bobX = Math.sin(this.bobPhase) * 0.011 * this.bobAmount;
    const bobY = Math.sin(this.bobPhase * 2) * 0.006 * this.bobAmount - 0.004 * this.bobAmount;
    const breath = Math.sin(this.time * 1.7) * 0.0022;
    this.arm.position.set(
      REST.x + rest.x + pose.x - this.swayX + bobX,
      REST.y + rest.y + pose.y + this.swayY + bobY + breath - this.air * 0.012,
      REST.z + rest.z + pose.z,
    );
    this.euler.set(
      REST_ROTATION.x + rest.rx + pose.rx + this.swayY * 2,
      REST_ROTATION.y + rest.ry + pose.ry + this.swayX * 3,
      REST_ROTATION.z + rest.rz + pose.rz + this.swayX * 4 + bobX * 2,
      'YXZ',
    );
    this.arm.quaternion.setFromEuler(this.euler);
  }

  /**
   * Turn the knife about its length and end over end, and open its parts. As it hangs, it moves
   * from its place in the grip onto the index finger, as the finger is this frame, to turn end over
   * end about the finger: its ring's hole round it, or its spine along it. Never allocates.
   */
  private placeKnife(pose: ArmPose): void {
    const wrist = this.hand.wrist;
    const held = this.knifeHand;
    const hang = clamp01(pose.hang);
    // A ring already on the finger slides along it, from where it sits in the grip.
    const along = held.threaded ? lerp(held.along, HANG_ALONG, hang) : HANG_ALONG;
    proximalAt(this.handPose, 0, along, this.hangAt, this.hangAxis);
    this.hangAt
      .applyQuaternion(wrist.quaternion)
      .add(wrist.position)
      .applyQuaternion(this.toHolder)
      .divideScalar(KNIFE_SIZE);
    this.hangAxis.applyQuaternion(wrist.quaternion).applyQuaternion(this.toHolder);
    // Toward the fingertip, which way along the knife's own turning axis.
    this.hangSide = this.hangAxis.x < 0 ? -1 : 1;
    if (this.hangAxis.x < 0) this.hangAxis.negate();
    this.hangTurn.setFromUnitVectors(X_AXIS, this.hangAxis);
    // Held, it turns about its length through the grip.
    this.spinTurn.setFromAxisAngle(Z_AXIS, -pose.spin);
    this.heldAt.copy(this.toPivot).applyQuaternion(this.spinTurn);
    if (held.threaded) {
      // Once the hand has opened, its handle turns out of the fist about the ring.
      const out = smoothstep(clamp01((hang - HANG.open) / (HANG.round - HANG.open)));
      this.flipper.position.copy(this.hangAt);
      this.flipper.quaternion.slerpQuaternions(this.spinTurn, this.hangTurn, out);
    } else {
      // Once the hand has opened, the knife swings out from the palm, round the hand rather than
      // through it, turning to hang as it comes round to the finger's line in front of the
      // fingertip; then it comes onto the finger along it, over the tip, as a ring goes on.
      const round = smoothstep(clamp01((hang - HANG.open) / (HANG.round - HANG.open)));
      const on = smoothstep(clamp01((hang - HANG.round) / (1 - HANG.round)));
      this.aheadAt
        .copy(this.hangAt)
        .addScaledVector(this.hangAxis, (HANG.ahead * this.hangSide) / KNIFE_SIZE);
      this.palmOut.set(-1, 0, 0).applyQuaternion(wrist.quaternion).applyQuaternion(this.toHolder);
      this.flipper.position
        .lerpVectors(this.heldAt, this.aheadAt, round)
        .lerp(this.hangAt, on)
        .addScaledVector(
          this.palmOut,
          (HANG.lift * (256 / 27) * round * (1 - round) ** 3) / KNIFE_SIZE,
        );
      this.flipper.quaternion.slerpQuaternions(this.spinTurn, this.hangTurn, round);
    }
    this.flipper.quaternion.multiply(this.flipTurn.setFromAxisAngle(X_AXIS, pose.flip));
    for (const { group, joint } of this.joints) {
      group.rotation.x = joint.sign * (joint.channel === 'a' ? pose.a : pose.b);
    }
  }

  /**
   * Bend the hand and put it where it goes: round the knife's handle, letting go while the knife
   * turns out of it, pointing while it is spun on the index finger, or bare, curling into a fist
   * to punch.
   */
  private poseHand(pose: ArmPose, inHand: boolean): void {
    const dt = this.frameDt;
    const wrist = this.hand.wrist;
    if (this.gripping) {
      const held = this.knifeHand;
      // Let go by how far the knife has turned out of the grip and how fast it is turning, so the
      // fingers stay open through a spin and close on the handle once it settles.
      const turning = Math.abs(turn(pose.flip, this.lastFlip)) > dt * 1.5 && dt > 0;
      this.lastFlip = pose.flip;
      // A folding blade or a butterfly's free handle swings through the fingers' side too.
      const folding = Math.abs(pose.a) > 0.05 || Math.abs(pose.b) > 0.05;
      const loose =
        !inHand || pose.hang > 0.02 || Math.abs(turn(pose.flip, 0)) > 0.25 || turning || folding;
      const target = loose ? 1 : 0;
      const rate = target > this.release ? 28 : 10;
      this.release += (target - this.release) * (1 - Math.exp(-dt * rate));
      const grip = held.grip.pose;
      // Turned about its length, the hand holds it looser, round the widest it gets as it turns,
      // until it is back the way it rests: a handle need not look the same upside down.
      const off = Math.abs(turn(pose.spin, 0));
      const turned = (off < Math.PI / 2 ? Math.sin(off) : 1) * (1 - clamp01(pose.hang));
      const roomy = held.turning;
      mixPose(this.handPose, grip, roomy.grip.pose, turned);
      // On its way to the index finger the knife leaves the open hand, which folds into a pointing
      // fist while the knife is clear of it, ready for the knife to turn about the finger.
      const hang = clamp01(pose.hang);
      const open = Math.max(this.release, smoothstep(clamp01(hang / HANG.open)));
      mixPose(this.handPose, this.handPose, held.open, open);
      const fold = held.threaded ? HANG.round : HANG.fold;
      const folded = held.threaded ? HANG.threadFolded : HANG.folded;
      const point = smoothstep(clamp01((hang - fold) / (folded - fold)));
      // The thumb, over the fist where the handle comes home, folds later and is out sooner.
      const thumb = held.threaded
        ? point
        : smoothstep(clamp01((hang - HANG.thumb) / (HANG.thumbFolded - HANG.thumb)));
      for (let i = 0; i < POSE_SIZE; i++) {
        const k = i < THUMB_AT ? point : thumb;
        this.handPose[i] = this.handPose[i]! + (POINT_POSE[i]! - this.handPose[i]!) * k;
      }
      // A ring on the finger keeps it through the ring, straightening as the ring slides out.
      if (held.threaded) {
        for (let i = 0; i < FINGER_STRIDE; i++) {
          this.handPose[i] = grip[i]! + (POINT_POSE[i]! - grip[i]!) * hang;
        }
      }
      wrist.position.lerpVectors(held.placement.position, roomy.placement.position, turned);
      wrist.quaternion.slerpQuaternions(
        held.placement.quaternion,
        roomy.placement.quaternion,
        turned,
      );
    } else {
      // The bare hand, palm down, curls into a fist and straightens behind the knuckles.
      const c = this.curl;
      mixPose(this.handPose, OPEN_POSE, FIST_POSE, c);
      wrist.position.copy(BARE_WRIST);
      this.bareTilt.set(lerp(0.15, 0, c), lerp(0.1, 0, c), lerp(-0.3, 0, c));
      wrist.quaternion.setFromEuler(this.bareTilt).multiply(BARE_TURN);
    }
    this.hand.pose(this.handPose);
    // The sleeve and its cuff end at the wrist, turned partway toward the hand.
    const toHand = this.gripping ? this.knifeHand.forearm : NO_TURN;
    const w = wrist.position;
    this.cuff.quaternion.copy(toHand);
    this.sleeve.quaternion.copy(toHand);
    this.cuff.position.set(0, 0, CUFF_FROM_WRIST).applyQuaternion(toHand).add(w);
    this.sleeve.position.set(0, 0, SLEEVE_FROM_WRIST).applyQuaternion(toHand).add(w);
  }
}
