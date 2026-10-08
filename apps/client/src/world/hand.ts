import {
  Bone,
  BufferGeometry,
  Float32BufferAttribute,
  Quaternion,
  Skeleton,
  SkinnedMesh,
  Uint16BufferAttribute,
  Vector3,
  type Material,
} from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';

/**
 * The player's own hand, for the view model: a palm, four fingers of three phalanges each and a
 * thumb, faceted like the kitchen, in one skinned mesh (one draw call), posed by the angle of every
 * joint. The fingers wrap whatever handle the hand holds (gripPose), each phalanx touching it, the
 * thumb closes over them (solved, not keyed), and the bare hand curls from open to a fist.
 *
 * Hand space: the wrist at the origin, the fingers reaching along -Z, the thumb's side +Y and the
 * back of the hand +X: a right hand, palm to the left, the way it holds a knife blade up.
 *
 * A pose is every joint's angle, in radians, in a flat array (POSE_SIZE): for each finger, index to
 * little, its metacarpal's cup (bent toward the palm at the wrist, which only the ring and little
 * fingers' can), its spread (fanning it toward the thumb's side in the palm's plane) and the bend
 * of its three joints toward the palm; then the thumb's swing toward the thumb's side, its swing
 * toward the palm, its roll about its own length, and the bend of its two joints.
 */

export interface Finger {
  /** Where its metacarpal meets the wrist, in hand space. */
  readonly carpal: readonly [number, number, number];
  /** How far its metacarpal can cup toward the palm, closing the hand round a handle. */
  readonly cup: number;
  /** The knuckle, in hand space, with the metacarpal straight. */
  readonly base: readonly [number, number, number];
  /** Proximal, middle and distal phalanx, knuckle to tip. */
  readonly lengths: readonly [number, number, number];
  readonly radius: number;
}

/**
 * Index, middle, ring and little finger; the knuckles step back from the middle finger's. The index
 * and middle fingers' metacarpals are fixed in the wrist; the ring and little fingers' cup, the
 * little finger's most, as a fist rounds on that side.
 */
export const FINGERS: readonly Finger[] = [
  {
    carpal: [0, 0.017, -0.012],
    cup: 0,
    base: [0.002, 0.0265, -0.081],
    lengths: [0.036, 0.022, 0.018],
    radius: 0.0085,
  },
  {
    carpal: [0, 0.005, -0.01],
    cup: 0,
    base: [0.002, 0.009, -0.083],
    lengths: [0.04, 0.025, 0.019],
    radius: 0.009,
  },
  {
    carpal: [0, -0.008, -0.012],
    cup: 0.22,
    base: [0.002, -0.0085, -0.078],
    lengths: [0.037, 0.024, 0.018],
    radius: 0.0085,
  },
  {
    carpal: [0, -0.019, -0.016],
    cup: 0.42,
    base: [0.002, -0.025, -0.07],
    lengths: [0.029, 0.018, 0.016],
    radius: 0.0075,
  },
];

/**
 * A handle crosses the palm on a slant, from the heel of the hand under the little finger to the
 * root of the index finger, by this much from straight across: so a knife stands out of the fist
 * leaning toward the fingers, and the wrist need not bend as far to aim it.
 */
export const GRIP_SLANT = 0.6;

/** The thumb: its metacarpal from the heel of the hand, then two phalanges. */
export const THUMB = {
  base: [-0.004, 0.02, -0.014] as const,
  lengths: [0.042, 0.03, 0.025] as const,
  radii: [0.0125, 0.0106, 0.0096] as const,
};

/** How thick the palm is where the fingers meet it: its palm side is at -PALM_HALF_THICKNESS. */
export const PALM_HALF_THICKNESS = 0.012;
/**
 * How far behind the middle finger's knuckle a handle lies across the palm: in the crease at the
 * root of the fingers, however thick it is.
 */
export const GRIP_DEPTH = 0.012;

/** A finger's entries in a pose, and where each is. */
export const FINGER_STRIDE = 5;
const CUP = 0;
const SPREAD = 1;
const BEND = 2;
const MIDDLE_JOINT = 3;
const LAST_JOINT = 4;
export const POSE_SIZE = FINGERS.length * FINGER_STRIDE + 5;
const THUMB_AT = FINGERS.length * FINGER_STRIDE;

/** A pose: every joint's angle (see the module comment for the layout). */
export type HandPose = Float32Array;

export function handPose(values: readonly number[] = []): HandPose {
  const pose = new Float32Array(POSE_SIZE);
  pose.set(values.slice(0, POSE_SIZE));
  return pose;
}

/** `out` from `a` toward `b` by `t`; never allocates. */
export function mixPose(out: HandPose, a: HandPose, b: HandPose, t: number): HandPose {
  for (let i = 0; i < POSE_SIZE; i++) out[i] = a[i]! + (b[i]! - a[i]!) * t;
  return out;
}

// ---------- Forward kinematics ----------

/** A phalanx as a capsule in hand space: from its joint to the next, and how thick it is. */
export interface Segment {
  readonly start: Vector3;
  readonly end: Vector3;
  radius: number;
}

/** Segments in order: each finger's three phalanges, index first, then the thumb's three. */
export const SEGMENT_COUNT = FINGERS.length * 3 + 3;

export function segments(): Segment[] {
  return Array.from({ length: SEGMENT_COUNT }, () => ({
    start: new Vector3(),
    end: new Vector3(),
    radius: 0,
  }));
}

const X_AXIS = new Vector3(1, 0, 0);
const Y_AXIS = new Vector3(0, 1, 0);
const Z_AXIS = new Vector3(0, 0, 1);
const fkQ = new Quaternion();
const fkStep = new Quaternion();
const fkKnuckle = new Quaternion();
const fkV = new Vector3();

/** The rotation a finger's knuckle takes: spread in the palm's plane, then bent toward the palm. */
function knuckle(spread: number, bend: number, out: Quaternion): Quaternion {
  out.setFromAxisAngle(X_AXIS, spread);
  return out.multiply(fkStep.setFromAxisAngle(Y_AXIS, bend));
}

/** The thumb's base: swung toward the thumb's side and the palm, and rolled about its length. */
function thumbBase(swing: number, toPalm: number, roll: number, out: Quaternion): Quaternion {
  out.setFromAxisAngle(X_AXIS, swing);
  out.multiply(fkStep.setFromAxisAngle(Y_AXIS, toPalm));
  return out.multiply(fkStep.setFromAxisAngle(Z_AXIS, roll));
}

const fkCup = new Quaternion();

/** Where a finger's knuckle is with its metacarpal cupped by `cup`, in hand space. */
export function knucklePosition(f: number, cup: number, out: Vector3): Vector3 {
  const { carpal, base } = FINGERS[f]!;
  out.set(base[0] - carpal[0], base[1] - carpal[1], base[2] - carpal[2]);
  out.applyQuaternion(fkCup.setFromAxisAngle(Y_AXIS, cup));
  out.x += carpal[0];
  out.y += carpal[1];
  out.z += carpal[2];
  return out;
}

/** Where every phalanx is in a pose, in hand space. Never allocates. */
export function handSegments(pose: HandPose, out: Segment[]): Segment[] {
  let s = 0;
  for (let f = 0; f < FINGERS.length; f++) {
    const finger = FINGERS[f]!;
    const a = f * FINGER_STRIDE;
    knucklePosition(f, pose[a + CUP]!, fkV);
    fkQ.copy(fkCup).multiply(knuckle(pose[a + SPREAD]!, pose[a + BEND]!, fkKnuckle));
    for (let j = 0; j < 3; j++) {
      if (j > 0) fkQ.multiply(fkStep.setFromAxisAngle(Y_AXIS, pose[a + BEND + j]!));
      const seg = out[s++]!;
      seg.start.copy(fkV);
      fkV.add(seg.end.set(0, 0, -finger.lengths[j]!).applyQuaternion(fkQ));
      seg.end.copy(fkV);
      seg.radius = finger.radius;
    }
  }
  fkV.set(...THUMB.base);
  thumbBase(pose[THUMB_AT]!, pose[THUMB_AT + 1]!, pose[THUMB_AT + 2]!, fkQ);
  for (let j = 0; j < 3; j++) {
    if (j > 0) fkQ.multiply(fkStep.setFromAxisAngle(Y_AXIS, pose[THUMB_AT + 2 + j]!));
    const seg = out[s++]!;
    seg.start.copy(fkV);
    fkV.add(seg.end.set(0, 0, -THUMB.lengths[j]!).applyQuaternion(fkQ));
    seg.end.copy(fkV);
    seg.radius = THUMB.radii[j]!;
  }
  return out;
}

// ---------- Grips ----------

/** A pose wrapped round a handle, and where the handle runs through the hand. */
export interface Grip {
  readonly pose: HandPose;
  /** The handle's axis through the hand, in hand space, toward the index finger. */
  readonly axis: Vector3;
  /** A point on that axis, in the middle of the fist. */
  readonly center: Vector3;
  /** Where each finger wraps round it (the middle of the circle it curls round), index first. */
  readonly through: readonly Vector3[];
  /**
   * How far along each finger's proximal phalanx it touches the handle, index first; -1 for a
   * finger the handle passes out of reach of, tucked into the palm beside it.
   */
  readonly touch: readonly number[];
  /** How thick the handle is. */
  readonly radius: number;
}

/**
 * Where a finger's proximal phalanx touches a handle it wraps, from the knuckle, when it wraps as a
 * hand most often does. A finger round a handle is a polygon round a circle: every phalanx touches
 * it, and from each joint the two phalanges either side reach the circle equally far (tangents
 * from a point are equal). With the middle phalanx touching at its middle, the proximal one touches
 * half a middle phalanx short of its far end and the distal one half a middle phalanx past its start.
 */
export function proximalTouch(f: number): number {
  const [l1, l2] = FINGERS[f]!.lengths;
  return l1 - l2 / 2;
}

/**
 * A finger wrapped round a round handle of `radius` whose axis crosses the finger's plane at
 * `toward`: every phalanx touching it. The proximal phalanx is the tangent from the knuckle to the
 * circle the finger curls round, so it touches as far along as the knuckle is from the handle
 * allows; from there each joint turns by twice the angle its equal tangents make at the middle. A
 * ring or little finger first cups its metacarpal, as little as it must, when the handle is out of
 * the finger's reach. Returns how far along the proximal phalanx it touches.
 */
function wrapFinger(f: number, radius: number, toward: Vector3, pose: HandPose): number {
  const finger = FINGERS[f]!;
  const [l1, l2] = finger.lengths;
  const rho = radius + finger.radius;
  // How far the knuckle is from the circle's middle, in the finger's plane.
  const knuckleAt = new Vector3();
  const reach = (cup: number): number => {
    knucklePosition(f, cup, knuckleAt);
    return Math.hypot(toward.x - knuckleAt.x, toward.z - knuckleAt.z);
  };
  // Cup only as far as it takes for the finger to reach round the handle before its middle joint.
  const longest = Math.hypot(l1 * 0.9, rho);
  let cup = 0;
  for (let i = 1; i <= 40 && reach(cup) > longest; i++) cup = (finger.cup * i) / 40;
  const distance = Math.max(rho * 1.02, reach(cup));
  // Tangent from the knuckle: it touches `touch` along, short enough for the middle phalanx to
  // touch too, and the circle's middle is atan2(rho, touch) round from the phalanx.
  const touch = Math.max(l1 - l2, Math.min(l1, Math.sqrt(distance * distance - rho * rho)));
  const [mx, , mz] = knucklePosition(f, cup, knuckleAt).toArray();
  // Round from straight on toward the palm; a handle back toward the wrist is past a half turn.
  let toAngle = Math.atan2(-(toward.x - mx), -(toward.z - mz));
  if (toAngle < -Math.PI / 2) toAngle += Math.PI * 2;
  // The bend counts from the metacarpal, which the cup has already turned toward the palm.
  const wanted = toAngle - Math.atan2(rho, touch) - cup;
  const bend = Math.max(0.15, Math.min(1.9, wanted));
  const fromPip = l1 - touch;
  const fromDip = Math.max(0, l2 - fromPip);
  const a = f * FINGER_STRIDE;
  pose[a + CUP] = cup;
  pose[a + SPREAD] = 0;
  pose[a + BEND] = bend;
  pose[a + MIDDLE_JOINT] = 2 * Math.atan2(fromPip, rho);
  pose[a + LAST_JOINT] = 2 * Math.atan2(fromDip, rho);
  // A handle that crosses the palm past where this finger can wrap it (a thin one, low in the
  // palm, under the little finger): the finger tucks into the palm beside it instead.
  if (Math.abs(wanted - bend) > 0.05 || distance > Math.hypot(l1, rho) + 0.002) {
    pose[a + BEND] = 1.55;
    pose[a + MIDDLE_JOINT] = 1.7;
    pose[a + LAST_JOINT] = 1.1;
    return -1;
  }
  return touch;
}

/** Where a finger wraps round the handle: the middle of the circle it curls round, in hand space. */
export function wrapCenter(grip: Grip, f: number, out: Vector3): Vector3 {
  if (grip.touch[f]! < 0) return onAxis(grip.center, grip.axis, FINGERS[f]!.base[1], out);
  const a = f * FINGER_STRIDE;
  const finger = FINGERS[f]!;
  const rho = grip.radius + finger.radius;
  const touch = grip.touch[f]!;
  knucklePosition(f, grip.pose[a + CUP]!, out);
  const bend = grip.pose[a + CUP]! + grip.pose[a + BEND]!;
  return out.set(
    out.x - touch * Math.sin(bend) - rho * Math.cos(bend),
    finger.base[1],
    out.z - touch * Math.cos(bend) + rho * Math.sin(bend),
  );
}

const gripSegments = segments();

/**
 * Ease a finger's last joint open until its tip clears the palm (a thin handle wraps past it), and
 * only then the joint before it, so the middle phalanx keeps touching the handle if it can.
 */
function clearPalm(f: number, pose: HandPose): void {
  const a = f * FINGER_STRIDE;
  for (let i = 0; i < 80; i++) {
    handSegments(pose, gripSegments);
    const tip = gripSegments[f * 3 + 2]!;
    // The palm's palm side is the plane x = -PALM_HALF_THICKNESS, back to the heel of the hand.
    if (tip.end.x < -PALM_HALF_THICKNESS - tip.radius * 0.6 || tip.end.z < FINGERS[f]!.base[2]) {
      return;
    }
    if (pose[a + LAST_JOINT]! > 0) pose[a + LAST_JOINT] = Math.max(0, pose[a + LAST_JOINT]! - 0.04);
    else pose[a + MIDDLE_JOINT] = Math.max(0, pose[a + MIDDLE_JOINT]! - 0.03);
  }
}

const c1 = new Vector3();
const c2 = new Vector3();
const d1 = new Vector3();
const d2 = new Vector3();
const r = new Vector3();

/** The shortest distance between segments p1-q1 and p2-q2 (Ericson, Real-Time Collision Detection). */
export function segmentDistance(p1: Vector3, q1: Vector3, p2: Vector3, q2: Vector3): number {
  d1.subVectors(q1, p1);
  d2.subVectors(q2, p2);
  r.subVectors(p1, p2);
  const a = d1.dot(d1);
  const e = d2.dot(d2);
  const f = d2.dot(r);
  let s = 0;
  let t = 0;
  if (a <= 1e-12 && e <= 1e-12) return r.length();
  if (a <= 1e-12) {
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const c = d1.dot(r);
    if (e <= 1e-12) {
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const b = d1.dot(d2);
      const denom = a * e - b * b;
      s = denom > 1e-12 ? Math.max(0, Math.min(1, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.max(0, Math.min(1, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.max(0, Math.min(1, (b - c) / a));
      }
    }
  }
  c1.copy(p1).addScaledVector(d1, s);
  c2.copy(p2).addScaledVector(d2, t);
  return c1.distanceTo(c2);
}

const lineFrom = new Vector3();
const lineTo = new Vector3();

/** How near a segment comes to a line (through `point` along unit `axis`) within a hand of it. */
export function lineDistance(p: Vector3, q: Vector3, point: Vector3, axis: Vector3): number {
  lineFrom.copy(point).addScaledVector(axis, -0.12);
  lineTo.copy(point).addScaledVector(axis, 0.12);
  return segmentDistance(p, q, lineFrom, lineTo);
}

const thumbSegments = segments();
const thumbTarget = [new Vector3(), new Vector3()];
/** How much worse sinking into a finger or the handle is than missing a target by as much. */
const OVERLAP = 600;

/**
 * Lay the thumb where a hand closes it, by nudging its five angles until its joint and tip reach
 * `ip` and `tip`, without sinking into the fingers or into a handle along `axis` through `center`
 * (`radius` 0 for none). A few thousand evaluations of the hand, once per grip.
 */
function solveThumb(
  pose: HandPose,
  ip: Vector3,
  tip: Vector3,
  handle: { center: Vector3; axis: Vector3; radius: number },
): void {
  thumbTarget[0]!.copy(ip);
  thumbTarget[1]!.copy(tip);
  const cost = (): number => {
    handSegments(pose, thumbSegments);
    let total = 0;
    const joint = thumbSegments[SEGMENT_COUNT - 2]!.end;
    const end = thumbSegments[SEGMENT_COUNT - 1]!.end;
    total += joint.distanceToSquared(thumbTarget[0]!) + end.distanceToSquared(thumbTarget[1]!);
    for (let j = 1; j < 3; j++) {
      const t = thumbSegments[SEGMENT_COUNT - 3 + j]!;
      for (let s = 0; s < FINGERS.length * 3; s++) {
        const f = thumbSegments[s]!;
        const gap = segmentDistance(t.start, t.end, f.start, f.end) - (t.radius + f.radius) * 0.92;
        if (gap < 0) total += gap * gap * OVERLAP;
      }
      if (handle.radius > 0) {
        const gap =
          lineDistance(t.start, t.end, handle.center, handle.axis) - handle.radius - t.radius;
        if (gap < 0) total += gap * gap * OVERLAP;
      }
    }
    return total;
  };
  let best = cost();
  for (let step = 0.25; step > 0.004; step *= 0.6) {
    for (let round = 0; round < 12; round++) {
      let moved = false;
      for (let i = THUMB_AT; i < THUMB_AT + 5; i++) {
        for (const sign of [1, -1]) {
          const was = pose[i]!;
          pose[i] = was + sign * step;
          const c = cost();
          if (c < best) {
            best = c;
            moved = true;
          } else {
            pose[i] = was;
          }
        }
      }
      if (!moved) break;
    }
  }
}

/**
 * Close the thumb over the fingers: its joint over the index finger's middle phalanx and its tip
 * over the middle finger's, just outside them, as a fist closes or a hand grips a handle.
 */
function wrapThumb(
  pose: HandPose,
  handle: { center: Vector3; axis: Vector3; radius: number },
): void {
  handSegments(pose, gripSegments);
  const target = (finger: number, radius: number, out: Vector3): Vector3 => {
    const seg = gripSegments[finger * 3 + 1]!;
    out.addVectors(seg.start, seg.end).multiplyScalar(0.5);
    // Out from the handle's axis (or the palm, for a fist) through the phalanx.
    const outward = out.clone().sub(handle.center);
    outward.addScaledVector(handle.axis, -outward.dot(handle.axis)).normalize();
    return out.addScaledVector(outward, seg.radius + radius);
  };
  const ip = target(0, THUMB.radii[1], new Vector3());
  const tip = target(1, THUMB.radii[2], new Vector3());
  pose[THUMB_AT] = 0.7;
  pose[THUMB_AT + 1] = 0.8;
  pose[THUMB_AT + 2] = -1;
  pose[THUMB_AT + 3] = 0.4;
  pose[THUMB_AT + 4] = 0.4;
  solveThumb(pose, ip, tip, handle);
}

/**
 * A fist round a handle of `radius`. The handle rests on the palm in the crease at the root of the
 * fingers (GRIP_DEPTH) and crosses the palm at `slant`; each finger wraps it where it crosses that
 * finger.
 */
export function gripPose(radius: number, slant = GRIP_SLANT): Grip {
  const pose = handPose();
  const through = FINGERS.map(() => new Vector3());
  // The handle lies along the palm, in the crease at the root of the fingers, behind the middle
  // finger's knuckle.
  const middle = FINGERS[1]!;
  const rest = new Vector3(
    -PALM_HALF_THICKNESS - radius,
    middle.base[1],
    middle.base[2] + GRIP_DEPTH,
  );
  // The handle's axis: through there, slanting toward the fingers on the index finger's side.
  const axis = new Vector3(0, 1, -Math.tan(slant)).normalize();
  const toward = new Vector3();
  const touch = FINGERS.map((finger, f) => {
    onAxis(rest, axis, finger.base[1], toward);
    const at = wrapFinger(f, radius, toward, pose);
    clearPalm(f, pose);
    return at;
  });
  const center = onAxis(rest, axis, (FINGERS[0]!.base[1] + FINGERS[3]!.base[1]) / 2, new Vector3());
  const grip = { pose, axis, center, through, touch, radius };
  FINGERS.forEach((_, f) => wrapCenter(grip, f, through[f]!));
  wrapThumb(pose, grip);
  return grip;
}

/** Where a handle's axis (through `point` along `axis`) crosses the plane y = `y`. */
export function onAxis(point: Vector3, axis: Vector3, y: number, out: Vector3): Vector3 {
  return out.copy(point).addScaledVector(axis, (y - point.y) / axis.y);
}

/** The longest and shortest way along the index finger's proximal phalanx a ring can sit. */
export const RING_ON_INDEX = { from: 0.35, to: 0.85 } as const;

/**
 * Where the index finger can thread a ring centered at `ring` (hand space), its knuckle bent to aim
 * the proximal phalanx straight through it: the bend, and how far along the phalanx the ring
 * sits, as a share of its length. Null if the ring is out of the finger's reach.
 */
export function indexThrough(ring: Vector3): { bend: number; along: number } | null {
  const index = FINGERS[0]!;
  const dx = ring.x - index.base[0];
  const dz = ring.z - index.base[2];
  const along = Math.hypot(dx, dz) / index.lengths[0];
  const bend = Math.atan2(-dx, -dz);
  if (along < RING_ON_INDEX.from || along > RING_ON_INDEX.to || bend < 0.1 || bend > 1.8) {
    return null;
  }
  return { bend, along };
}

/**
 * The grip with its index finger off the handle and through a ring at the handle's end instead
 * (a karambit's), aimed at `ring` (hand space) and curled past it; the thumb closes over again.
 */
export function threadIndex(grip: Grip, ring: Vector3): Grip {
  const through = indexThrough(ring);
  if (!through) return grip;
  const pose = grip.pose.slice();
  pose[CUP] = 0;
  pose[SPREAD] = 0;
  pose[BEND] = through.bend;
  // Past the ring the finger curls on toward the palm, round the ring's band.
  pose[MIDDLE_JOINT] = 1.15;
  pose[LAST_JOINT] = 0.85;
  wrapThumb(pose, grip);
  return { ...grip, pose };
}

/**
 * Where a finger's proximal phalanx touches the handle in a grip: a ring that sits that far off the
 * handle's axis, that way round, threads the finger there.
 */
export function proximalContact(grip: Grip, f: number, out: Vector3): Vector3 {
  handSegments(grip.pose, gripSegments);
  const seg = gripSegments[f * 3]!;
  return out.lerpVectors(seg.start, seg.end, grip.touch[f]! / FINGERS[f]!.lengths[0]);
}

/** The bare hand clenched for a punch: fingers folded tight into the palm, the thumb across them. */
export const FIST_POSE: HandPose = gripPose(0.003).pose;

/**
 * The bare hand at rest: fingers relaxed and a little curled, fanned a touch, and the thumb's joint
 * and tip beside the index finger, a little toward the palm.
 */
export const OPEN_POSE: HandPose = (() => {
  const pose = handPose([
    0, 0.09, 0.2, 0.3, 0.16, 0, 0.01, 0.24, 0.36, 0.2, 0, -0.07, 0.3, 0.42, 0.22, 0, -0.16, 0.38,
    0.5, 0.26,
    // The thumb, before solving: swung out and a little toward the palm.
    0.5, 0.25, -0.9, 0.25, 0.2,
  ]);
  solveThumb(pose, new Vector3(-0.013, 0.047, -0.058), new Vector3(-0.016, 0.043, -0.084), {
    center: new Vector3(),
    axis: Y_AXIS,
    radius: 0,
  });
  return pose;
})();

/** How far a hand opens from its grip, toward OPEN_POSE, to let a spinning knife's handle go. */
export const LOOSENED = 0.55;

// ---------- Placing the hand on a handle ----------

/** Where the hand goes: the wrist's position and turn, in the space the knife is held in. */
export interface Placement {
  readonly position: Vector3;
  readonly quaternion: Quaternion;
}

const pa = new Vector3();
const pb = new Vector3();
const pq = new Quaternion();

/** The signed angle from `a` to `b` about `axis`, both first flattened onto the plane across it. */
function angleAbout(a: Vector3, b: Vector3, axis: Vector3): number {
  pa.copy(a).projectOnPlane(axis);
  pb.copy(b).projectOnPlane(axis);
  if (pa.lengthSq() < 1e-12 || pb.lengthSq() < 1e-12) return 0;
  pa.normalize();
  pb.normalize();
  return Math.atan2(pa.clone().cross(pb).dot(axis), pa.dot(pb));
}

/**
 * Turn and place the hand so a grip's handle axis (`handAxis` through `center`, hand space) lies
 * along `axis` through `point`, turned about it so the hand carries on from the forearm (`forearm`,
 * wrist toward fingers) as straight as it can, or `turn` radians round from there.
 */
export function placeHand(
  handAxis: Vector3,
  center: Vector3,
  axis: Vector3,
  point: Vector3,
  forearm: Vector3,
  turn = 0,
): Placement {
  const quaternion = new Quaternion().setFromUnitVectors(handAxis, axis);
  const reach = new Vector3(0, 0, -1).applyQuaternion(quaternion);
  const twist = angleAbout(reach, forearm, axis) + turn;
  quaternion.premultiply(pq.setFromAxisAngle(axis, twist));
  const position = point.clone().sub(center.clone().applyQuaternion(quaternion));
  return { position, quaternion };
}

/** How far a placement bends the wrist from straight on along the forearm, in radians. */
export function wristBend(placement: Placement, forearm: Vector3): number {
  return new Vector3(0, 0, -1).applyQuaternion(placement.quaternion).angleTo(forearm);
}

// ---------- The mesh ----------

/** Points round a ring across Z: an ellipse a little flatter from back to palm than across. */
function ring(points: Vector3[], z: number, r: number, sides = 6, at = new Vector3()): void {
  for (let i = 0; i < sides; i++) {
    const a = ((i + 0.5) / sides) * Math.PI * 2;
    points.push(new Vector3(at.x + Math.cos(a) * r * 0.88, at.y + Math.sin(a) * r, at.z + z));
  }
}

/**
 * A phalanx from its joint (the origin) to the next joint (at -length along Z), rounded over both
 * joints so a bent finger never opens a gap: the caps of neighbouring phalanges overlap like knuckles.
 */
function phalanx(length: number, r0: number, r1: number, tip: boolean): Vector3[] {
  const points: Vector3[] = [];
  ring(points, r0 * 0.6, r0 * 0.62);
  ring(points, 0, r0);
  ring(points, -length, r1);
  ring(points, -length - r1 * (tip ? 0.55 : 0.6), r1 * (tip ? 0.72 : 0.62));
  if (tip) points.push(new Vector3(0.0015, 0, -length - r1 * 0.95));
  return points;
}

/** A point of a hull and how it is skinned: to `bone`, blended by `weight` with the wrist. */
interface SkinnedPoint {
  readonly point: Vector3;
  readonly bone: number;
  readonly weight: number;
}

/** The bone of finger `f`'s metacarpal, then its three phalanges (the wrist is bone 0). */
const fingerBone = (f: number, j: number): number => 1 + f * 4 + j;
const THUMB_BONE = 1 + FINGERS.length * 4;

/**
 * The palm, a faceted block from the wrist to the knuckles with the ball of the thumb on it. Round
 * each knuckle it moves with that finger's metacarpal; across the hand on the little finger's side
 * it is shared between the wrist and the little finger's, so the palm cups as the fist closes.
 */
function palmPoints(): SkinnedPoint[] {
  const wrist = (point: Vector3): SkinnedPoint => ({ point, bone: 0, weight: 0 });
  const points: SkinnedPoint[] = [];
  const cuff: Vector3[] = [];
  ring(cuff, 0.004, 0.025, 8);
  for (const p of cuff) points.push(wrist(p.setX(p.x * 0.5)));
  FINGERS.forEach(({ base, radius }, f) => {
    const [x, y, z] = base;
    const bone = fingerBone(f, 0);
    for (const p of [
      new Vector3(x + 0.0105, y, z + 0.003),
      new Vector3(x - 0.012, y, z + 0.011),
      new Vector3(x + 0.004, y + radius * 0.7, z + 0.004),
      new Vector3(x + 0.004, y - radius * 0.7, z + 0.004),
    ]) {
      points.push({ point: p, bone, weight: 1 });
    }
  });
  const little = fingerBone(3, 0);
  points.push(
    // Across the middle of the hand, back and palm.
    wrist(new Vector3(0.0125, 0.032, -0.042)),
    { point: new Vector3(0.0125, -0.031, -0.042), bone: little, weight: 0.5 },
    wrist(new Vector3(-0.0125, 0.031, -0.045)),
    { point: new Vector3(-0.0125, -0.031, -0.045), bone: little, weight: 0.5 },
    // The heel of the hand under the little finger.
    { point: new Vector3(-0.0145, -0.026, -0.03), bone: little, weight: 0.3 },
    { point: new Vector3(0.002, -0.0345, -0.05), bone: little, weight: 0.6 },
    wrist(new Vector3(0.002, 0.0355, -0.064)),
  );
  return points;
}

/**
 * One skinned piece: a convex hull of points in hand space, each corner moved by its point's bone
 * (and the wrist), or all of it by `bone`.
 */
function piece(points: readonly (Vector3 | SkinnedPoint)[], bone = 0): BufferGeometry {
  const skinned = points.map((p) => (p instanceof Vector3 ? { point: p, bone, weight: 1 } : p));
  const geometry = new ConvexGeometry(skinned.map((p) => p.point));
  const position = geometry.getAttribute('position');
  const index = new Uint16Array(position.count * 4);
  const weight = new Float32Array(position.count * 4);
  const corner = new Vector3();
  for (let i = 0; i < position.count; i++) {
    // The hull's corners are the points themselves.
    corner.fromBufferAttribute(position, i);
    let nearest = skinned[0]!;
    for (const p of skinned) {
      if (p.point.distanceToSquared(corner) < nearest.point.distanceToSquared(corner)) nearest = p;
    }
    index[i * 4] = nearest.bone;
    weight[i * 4] = nearest.weight;
    index[i * 4 + 1] = 0;
    weight[i * 4 + 1] = 1 - nearest.weight;
  }
  geometry.setAttribute('skinIndex', new Uint16BufferAttribute(index, 4));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute(weight, 4));
  return geometry;
}

function merge(pieces: readonly BufferGeometry[]): BufferGeometry {
  const merged = new BufferGeometry();
  for (const [name, size] of [
    ['position', 3],
    ['normal', 3],
    ['skinIndex', 4],
    ['skinWeight', 4],
  ] as const) {
    let length = 0;
    for (const p of pieces) length += p.getAttribute(name).array.length;
    const array = name === 'skinIndex' ? new Uint16Array(length) : new Float32Array(length);
    let offset = 0;
    for (const p of pieces) {
      const source = p.getAttribute(name).array;
      array.set(source, offset);
      offset += source.length;
    }
    merged.setAttribute(
      name,
      name === 'skinIndex'
        ? new Uint16BufferAttribute(array, size)
        : new Float32BufferAttribute(array, size),
    );
  }
  for (const p of pieces) p.dispose();
  return merged;
}

/**
 * The hand as one skinned mesh, posed with `pose`. Its root bone is the wrist; each finger hangs
 * from its metacarpal, then its three phalanges; the thumb from the wrist.
 */
export class HandRig {
  readonly mesh: SkinnedMesh;
  /** The wrist: place and turn this to put the hand where it goes. */
  readonly wrist: Bone;
  private readonly metacarpals: Bone[] = [];
  private readonly knuckles: Bone[] = [];
  private readonly joints: Bone[] = [];
  private readonly thumb: Bone[] = [];

  constructor(material: Material) {
    this.wrist = new Bone();
    const bones: Bone[] = [this.wrist];
    const pieces: BufferGeometry[] = [piece(palmPoints())];
    for (const finger of FINGERS) {
      const metacarpal = new Bone();
      metacarpal.position.set(...finger.carpal);
      this.wrist.add(metacarpal);
      this.metacarpals.push(metacarpal);
      bones.push(metacarpal);
      let parent = metacarpal;
      let at = new Vector3(...finger.base);
      for (let j = 0; j < 3; j++) {
        const bone = new Bone();
        if (j === 0) bone.position.copy(at).sub(new Vector3(...finger.carpal));
        else bone.position.set(0, 0, -finger.lengths[j - 1]!);
        parent.add(bone);
        (j === 0 ? this.knuckles : this.joints).push(bone);
        const r0 = finger.radius * (1 - 0.04 * j);
        const points = phalanx(finger.lengths[j]!, r0, r0 * 0.93, j === 2);
        for (const p of points) p.add(at);
        pieces.push(piece(points, bones.length));
        bones.push(bone);
        at = at.clone().add(new Vector3(0, 0, -finger.lengths[j]!));
        parent = bone;
      }
    }
    let parent = this.wrist;
    let at = new Vector3(...THUMB.base);
    for (let j = 0; j < 3; j++) {
      const bone = new Bone();
      bone.position.copy(j === 0 ? at : new Vector3(0, 0, -THUMB.lengths[j - 1]!));
      parent.add(bone);
      this.thumb.push(bone);
      const r0 = THUMB.radii[j]!;
      const points = phalanx(THUMB.lengths[j]!, r0, r0 * 0.92, j === 2);
      for (const p of points) p.add(at);
      pieces.push(piece(points, THUMB_BONE + j));
      bones.push(bone);
      at = at.clone().add(new Vector3(0, 0, -THUMB.lengths[j]!));
      parent = bone;
    }
    const geometry = merge(pieces);
    this.mesh = new SkinnedMesh(geometry, material);
    this.mesh.name = 'hand';
    this.mesh.add(this.wrist);
    this.mesh.updateMatrixWorld(true);
    this.mesh.bind(new Skeleton(bones));
    // Always in view, and its bones carry it well outside its bind-pose bounds.
    this.mesh.frustumCulled = false;
  }

  /** Bend every joint to `pose`. Never allocates. */
  pose(pose: HandPose): void {
    for (let f = 0; f < FINGERS.length; f++) {
      const a = f * FINGER_STRIDE;
      this.metacarpals[f]!.quaternion.setFromAxisAngle(Y_AXIS, pose[a + CUP]!);
      knuckle(pose[a + SPREAD]!, pose[a + BEND]!, this.knuckles[f]!.quaternion);
      this.joints[f * 2]!.quaternion.setFromAxisAngle(Y_AXIS, pose[a + MIDDLE_JOINT]!);
      this.joints[f * 2 + 1]!.quaternion.setFromAxisAngle(Y_AXIS, pose[a + LAST_JOINT]!);
    }
    thumbBase(pose[THUMB_AT]!, pose[THUMB_AT + 1]!, pose[THUMB_AT + 2]!, this.thumb[0]!.quaternion);
    this.thumb[1]!.quaternion.setFromAxisAngle(Y_AXIS, pose[THUMB_AT + 3]!);
    this.thumb[2]!.quaternion.setFromAxisAngle(Y_AXIS, pose[THUMB_AT + 4]!);
  }
}
