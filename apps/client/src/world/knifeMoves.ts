import { KNIFE_SKINS, type KnifeSkin } from '@world/shared';

/**
 * How each knife moves in the hand on screen, after CS2's: its draw, its idle, and its inspect,
 * as keyframed clips over the view model's pose. One table, one entry per knife, so a knife's whole
 * personality is in one place and the view model has no knife-specific code.
 */

/** Throw timeline, in seconds from the key press. The knife leaves the hand at RELEASE. */
export const THROW = {
  windUp: 0.09,
  release: 0.12,
  snap: 0.16,
  followThrough: 0.34,
  drawFrom: 0.5,
  drawTo: 0.8,
} as const;
/** Switching between knife and hand: the one lowers, then the other rises. */
export const SWITCH = { lower: 0.12, raise: 0.34 } as const;

/** Offsets from the resting pose, in camera space (meters and radians), and the knife in the hand. */
export interface ArmPose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  /** The knife is in the hand (not thrown yet, or drawn again). */
  knife: boolean;
  /**
   * The wrist flexing: hand and knife turned together about the wrist, about the line of the
   * knuckles, toward the palm (positive) or back toward the back of the hand (negative).
   */
  flex: number;
  /** The wrist swinging, about the back of the hand's normal, toward the thumb (positive) or the little finger. */
  dev: number;
  /** The knife's own moving parts: a folding blade, a butterfly's blade and its free handle. */
  a: number;
  b: number;
  /**
   * How far the fingers have loosened on the handle, from firm (0) to off it (1), where a blade or
   * handle swings through the place they hold it: the fingers loosen, and close again after.
   */
  loose: number;
}

/** Every channel a clip can key, in the order they are stored. */
export const CHANNELS = [
  'x',
  'y',
  'z',
  'rx',
  'ry',
  'rz',
  'flex',
  'dev',
  'a',
  'b',
  'loose',
] as const;
export type Channel = (typeof CHANNELS)[number];
/** The first channel that is the knife's own mechanism, and the grip on it, not the arm or the wrist. */
const HINGES = CHANNELS.indexOf('a');

/**
 * How a key is arrived at. `flow` carries the motion through the key on a smooth curve, slowing to
 * a stop at it only where the motion turns round or holds; `smooth` is a stop at every key, the way
 * a hand goes from one place to rest in another (the minimum-jerk curve: speed and acceleration both
 * start and end at nothing). `snap` is a flick: it too starts from nothing, but is at its top speed
 * early, as a spring let go or a wrist snapped is, and not in an instant. `linear` keeps a speed going through it, `in` and `out`
 * accelerate or decelerate, `back` overshoots a little and settles, like a hand snapping into place.
 */
export type Ease = 'flow' | 'smooth' | 'linear' | 'in' | 'out' | 'back' | 'snap';
const EASES: readonly Ease[] = ['flow', 'smooth', 'linear', 'in', 'out', 'back', 'snap'];
const FLOW = EASES.indexOf('flow');

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
export const easeInCubic = (t: number): number => t * t * t;
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
/** Overshoots a little and settles, like a hand snapping into place. */
export const easeOutBack = (t: number): number => {
  const c = 1.7;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

/** The minimum-jerk curve from 0 to 1: speed and acceleration are nothing at both ends. */
export const minimumJerk = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

function ease(kind: number, t: number): number {
  switch (kind) {
    case 2:
      return t;
    case 3:
      return easeInCubic(t);
    case 4:
      return easeOutCubic(t);
    case 5:
      return easeOutBack(t);
    case 6:
      return minimumJerk(1 - (1 - t) ** 1.5);
    default:
      return minimumJerk(t);
  }
}

/** A key: a time, and any channels that change there; the rest carry on from the key before. */
export type Key = { readonly t: number; readonly ease?: Ease; readonly hingeEase?: Ease } & {
  readonly [C in Channel]?: number;
};

/** A compiled clip: flat arrays, so sampling it never allocates. */
export interface Clip {
  readonly duration: number;
  readonly times: Float64Array;
  /** CHANNELS.length values per key. */
  readonly values: Float64Array;
  /** How a channel's speed is at each key where the motion flows through it, per key and channel. */
  readonly slopes: Float64Array;
  /** How each key is arrived at, for the arm and the wrist and for the knife's hinges. */
  readonly armEase: Uint8Array;
  readonly hingeEase: Uint8Array;
}

/**
 * The speed a motion flowing through a key goes at, from the keys either side: nothing where the
 * motion turns round or holds, and otherwise a weighted mean of the two slopes (Fritsch and Butland's),
 * which never overshoots either neighbor.
 */
function flowSlope(
  times: Float64Array,
  values: Float64Array,
  n: number,
  i: number,
  c: number,
): number {
  const h0 = times[i]! - times[i - 1]!;
  const h1 = times[i + 1]! - times[i]!;
  const d0 = (values[i * n + c]! - values[(i - 1) * n + c]!) / h0;
  const d1 = (values[(i + 1) * n + c]! - values[i * n + c]!) / h1;
  if (d0 * d1 <= 0) return 0;
  const w0 = 2 * h1 + h0;
  const w1 = h1 + 2 * h0;
  return (w0 + w1) / (w0 / d0 + w1 / d1);
}

/** Compile keys (in time order, the first at 0) into a clip. Channels not keyed start at 0. */
export function clip(keys: readonly Key[]): Clip {
  const n = CHANNELS.length;
  const times = new Float64Array(keys.length);
  const values = new Float64Array(keys.length * n);
  const armEase = new Uint8Array(keys.length);
  const hingeEase = new Uint8Array(keys.length);
  keys.forEach((key, i) => {
    if (i > 0 && key.t <= keys[i - 1]!.t) throw new Error('keys must move forward in time');
    times[i] = key.t;
    CHANNELS.forEach((channel, c) => {
      values[i * n + c] = key[channel] ?? (i > 0 ? values[(i - 1) * n + c]! : 0);
    });
    armEase[i] = EASES.indexOf(key.ease ?? 'flow');
    hingeEase[i] = EASES.indexOf(key.hingeEase ?? key.ease ?? 'flow');
  });
  // A channel flows through a key only if the curve is the flowing one on both sides of it.
  const slopes = new Float64Array(keys.length * n);
  for (let i = 1; i < keys.length - 1; i++) {
    for (let c = 0; c < n; c++) {
      const eases = c < HINGES ? armEase : hingeEase;
      if (eases[i] === FLOW && eases[i + 1] === FLOW) {
        slopes[i * n + c] = flowSlope(times, values, n, i, c);
      }
    }
  }
  return { duration: keys[keys.length - 1]!.t, times, values, slopes, armEase, hingeEase };
}

/** The pose `t` seconds into a clip. Past its end it holds its last key. */
export function sample(c: Clip, t: number, out: ArmPose): ArmPose {
  const n = CHANNELS.length;
  const last = c.times.length - 1;
  out.knife = true;
  if (last === 0 || t >= c.duration) {
    for (let ch = 0; ch < n; ch++) out[CHANNELS[ch]!] = c.values[last * n + ch]!;
    return out;
  }
  let i = 0;
  while (i < last - 1 && t >= c.times[i + 1]!) i++;
  const t0 = c.times[i]!;
  const h = c.times[i + 1]! - t0;
  const k = Math.max(0, Math.min(1, (t - t0) / h));
  for (let ch = 0; ch < n; ch++) {
    const eases = ch < HINGES ? c.armEase : c.hingeEase;
    const kind = eases[i + 1]!;
    const a = c.values[i * n + ch]!;
    const b = c.values[(i + 1) * n + ch]!;
    if (kind === FLOW) {
      // A quintic Hermite curve through both keys, at the speeds flowing through them and with no
      // acceleration at either, so that the acceleration is the same either side of every key.
      const k3 = k * k * k;
      const k4 = k3 * k;
      const k5 = k4 * k;
      out[CHANNELS[ch]!] =
        (1 - 10 * k3 + 15 * k4 - 6 * k5) * a +
        (k - 6 * k3 + 8 * k4 - 3 * k5) * h * c.slopes[i * n + ch]! +
        (10 * k3 - 15 * k4 + 6 * k5) * b +
        (-4 * k3 + 7 * k4 - 3 * k5) * h * c.slopes[(i + 1) * n + ch]!;
    } else {
      out[CHANNELS[ch]!] = a + (b - a) * ease(kind, k);
    }
  }
  return out;
}

/** The same clip played in `duration` seconds instead, starting from `from` (arm only). */
function retimed(
  keys: readonly Key[],
  duration: number,
  from: Partial<Record<Channel, number>>,
): Key[] {
  const scale = duration / keys[keys.length - 1]!.t;
  return keys.map((key, i) => ({ ...key, ...(i === 0 ? from : {}), t: key.t * scale }));
}

/** Below the screen, where the arm goes while nothing is in hand. */
export const LOWERED = { y: -0.34, rx: 0.5 } as const;
/** Where the follow-through ends, out of view; the next knife is drawn up from here. */
export const SPENT = { x: -0.04, y: LOWERED.y, z: 0, rx: 1.1, ry: -0.2, rz: 0.15 } as const;

export interface KnifeMoves {
  /** Rising into view from LOWERED, when the knife is drawn (Q, or coming back into the world). */
  readonly draw: Clip;
  /** A fresh knife after a throw, up from SPENT in THROW.drawTo - THROW.drawFrom seconds. */
  readonly redraw: Clip;
  /** Played over and over while the knife is up and nothing else is going on. Empty for none. */
  readonly idle: Clip;
  /** A long look at the knife (I). */
  readonly inspect: Clip;
  /** Where the arm rests with this knife, from the usual rest: a karambit is held higher. */
  readonly rest: Readonly<Offset>;
  /**
   * The angles between which a hinge sweeps through the fingers, if it does: the hand loosens before
   * it is swung through them, and not otherwise.
   */
  readonly through: Readonly<Partial<Record<'a' | 'b', readonly [number, number]>>>;
}

/** An offset of the arm, in camera space. */
export interface Offset {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
}

const REDRAW = THROW.drawTo - THROW.drawFrom;
const PI = Math.PI;

interface MoveKeys {
  draw: readonly Key[];
  /** Defaults to the draw, quickened to fit and started from where a throw leaves the arm. */
  redraw?: readonly Key[];
  idle?: readonly Key[];
  inspect: readonly Key[];
  rest?: Partial<Offset>;
  through?: KnifeMoves['through'];
}

/** The draw's first key: below the screen. */
const DOWN = { t: 0, x: 0, y: LOWERED.y, z: 0, rx: LOWERED.rx, ry: 0, rz: 0 } as const;
/** At rest, with the knife as it rests in the hand. */
const REST = {
  x: 0,
  y: 0,
  z: 0,
  rx: 0,
  ry: 0,
  rz: 0,
  flex: 0,
  dev: 0,
  a: 0,
  b: 0,
  loose: 0,
} as const;

/**
 * Where the hand takes a knife it holds blade up and forward, as offsets from rest, to show it:
 * lifted toward the eye (the usual flat to it), turned over by the forearm and the wrist to show
 * the spine, the other flat, the edge, and tipped to look along the blade. Each is the arm (the
 * elbow and shoulder bringing it up, across and in), the forearm's roll, and the wrist's flexion,
 * and none asks more of a wrist than it gives (`viewmodelGrounded.test.ts`).
 */
const FLAT = { x: -0.03, y: 0.09, z: 0.1, rx: -0.12, ry: 0.05, rz: 0, flex: 0, dev: 0 } as const;
const SPINE = {
  x: -0.11,
  y: 0.08,
  z: 0.12,
  rx: 0,
  ry: -0.26,
  rz: 0.58,
  flex: -0.62,
  dev: 0,
} as const;
const OTHER = {
  x: -0.16,
  y: 0.09,
  z: 0.12,
  rx: 0.1,
  ry: -0.5,
  rz: 1.15,
  flex: -0.85,
  dev: 0,
} as const;
const EDGE = { x: 0, y: 0.08, z: 0.06, rx: -0.05, ry: 0.2, rz: -0.8, flex: 0.45, dev: 0 } as const;
const TIP = {
  x: -0.06,
  y: 0.07,
  z: 0.12,
  rx: 0.3,
  ry: 0.2,
  rz: 0.5,
  flex: -0.2,
  dev: 0.27,
} as const;
/** The blade canted across the view to the left or the right, a flat turned to the eye. */
const CANT_LEFT = {
  x: -0.08,
  y: 0.1,
  z: 0.1,
  rx: -0.2,
  ry: 0,
  rz: 0.7,
  flex: 0.4,
  dev: 0,
} as const;
const CANT_RIGHT = {
  x: -0.02,
  y: 0.1,
  z: 0.1,
  rx: -0.2,
  ry: 0,
  rz: -0.6,
  flex: -0.4,
  dev: 0,
} as const;
/** The blade swung out to catch the light along its flat, and the wrist bent to show it whole. */
const LIGHT = { x: 0, y: 0.08, z: 0.08, rx: 0, ry: 0.5, rz: -0.4, flex: 0, dev: 0 } as const;
const BEND = { x: -0.05, y: 0.1, z: 0.1, rx: 0, ry: 0, rz: 0, flex: 1, dev: 0 } as const;
const SWUNG = { x: -0.05, y: 0.1, z: 0.1, rx: -0.2, ry: 0, rz: 0, flex: 0, dev: 0.4 } as const;
/** A hand's small dip before it lifts, so the lift has something to push off. */
const DIP = { y: -0.012, rx: 0.04 } as const;

/** Some of a pose's channels. */
type Pose = { readonly [C in Channel]?: number };

/** A pose `k` of the way from rest: a heavy knife is turned less. */
function part(pose: Pose, k: number): Pose {
  return Object.fromEntries(Object.entries(pose).map(([c, v]) => [c, (v ?? 0) * k]));
}

/**
 * A knife drawn: the hand comes up from below the screen with its wrist turning into place (`from`
 * where it starts, `mid` as it comes into view), arrives a touch past rest, as far as the knife's
 * weight carries it (`weight`: a heavy knife overshoots more), and settles.
 */
function rise(time: number, from: Pose, mid: Pose, weight = 1): readonly Key[] {
  const over = part(mid, -0.25);
  return [
    { ...DOWN, ...from },
    { ...REST, t: time * 0.4, y: -0.045, rx: 0.12, ...mid },
    { ...REST, t: time * 0.68, ...over, y: 0.012 * weight, rx: -0.035 * weight },
    { ...REST, t: time },
  ];
}

const CHEF_INSPECT: readonly Key[] = [
  { t: 0, ...REST },
  { t: 0.22, y: -0.015, rx: 0.045 },
  // Lifted into view and turned to show the flat, a long look...
  { t: 0.72, x: -0.03, y: 0.07, z: 0.07, rz: -0.2, flex: 0.15, rx: -0.1 },
  { t: 1.3, x: -0.02, y: 0.09, z: 0.1, rz: -0.42, flex: 0.27, dev: 0.06, rx: -0.18, ry: 0.1 },
  { t: 1.75, x: -0.025, y: 0.095, z: 0.1, rz: -0.44, flex: 0.3, dev: 0.06, rx: -0.19, ry: 0.11 },
  // ...rolled over, the spine to the eye on the way, to show the other side...
  { t: 2.35, x: -0.08, y: 0.08, z: 0.1, rz: 0.15, flex: -0.34, dev: 0, rx: -0.13, ry: -0.17 },
  { t: 2.95, x: -0.17, y: 0.1, z: 0.1, rz: 0.93, flex: -0.33, dev: 0.12, rx: 0.09, ry: -0.32 },
  { t: 3.4, x: -0.17, y: 0.1, z: 0.1, rz: 0.95, flex: -0.33, dev: 0.12, rx: 0.1, ry: -0.33 },
  // ...and lowered home.
  { t: 4.1, ...REST },
];

const MOVES: Readonly<Record<KnifeSkin, MoveKeys>> = {
  kitchen: { draw: rise(0.55, {}, {}, 1.2), inspect: CHEF_INSPECT },

  karambit: {
    rest: { y: 0.05 },
    draw: rise(0.62, { rz: -0.4, flex: -0.6 }, { rz: 0.15, flex: 0.3 }),
    idle: [
      { t: 0, ...REST },
      { t: 2.2, ...REST },
      { t: 2.8, ry: -0.04, rz: 0.07, ease: 'smooth' },
      { t: 3.6, ry: 0, rz: 0, ease: 'smooth' },
      { t: 6, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      { t: 0.14, y: -0.01, rx: 0.04 },
      { t: 0.6, x: -0.06, y: 0.1, z: 0.09, rx: -0.2, rz: -0.35, flex: 0, dev: 0 },
      { t: 1.25, x: -0.06, y: 0.1, z: 0.09, rx: -0.2, rz: -0.38, flex: 0.05, dev: 0 },
      { t: 1.9, x: -0.07, y: 0.12, z: 0.09, rx: -0.2, rz: -0.7, flex: -0.5, dev: 0 },
      { t: 2.4, x: -0.07, y: 0.12, z: 0.09, rx: -0.2, rz: -0.72, flex: -0.52, dev: 0 },
      { t: 3.05, x: -0.05, y: 0.1, z: 0.09, rx: -0.2, rz: 0.7, flex: 0, dev: 0 },
      { t: 3.5, x: -0.05, y: 0.1, z: 0.09, rx: -0.2, rz: 0.72, flex: 0, dev: 0 },
      { t: 4.15, ...REST },
    ],
  },

  butterfly: {
    draw: [
      { ...DOWN, a: -PI, b: PI },
      { ...REST, t: 0.2, y: -0.05, rx: 0.14, a: -PI, b: PI },
      {
        ...REST,
        t: 0.4,
        y: 0.012,
        rx: -0.05,
        rz: 0.15,
        flex: -0.25,
        a: 0,
        b: PI,
        hingeEase: 'snap',
      },
      { ...REST, t: 0.62, y: 0.01, rz: 0.03, flex: 0.08, hingeEase: 'snap' },
      { ...REST, t: 0.86 },
    ],
    idle: [
      { t: 0, ...REST },
      { t: 2.5, ...REST },
      { t: 2.75, b: 0.35, rz: 0.04, ease: 'smooth', hingeEase: 'snap' },
      { t: 3.15, b: 0, rz: 0, ease: 'smooth' },
      { t: 5.5, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      { t: 0.14, ...DIP },
      { t: 0.55, ...FLAT },
      { t: 0.95, ...FLAT },
      // Shut: the free handle swings round its pin, then the blade folds in between the handles.
      { t: 1.3, ...CANT_RIGHT, b: PI, hingeEase: 'smooth' },
      { t: 1.7, ...CANT_RIGHT, a: -PI, b: PI, hingeEase: 'smooth' },
      { t: 2.05, ...CANT_RIGHT, a: -PI, b: PI },
      // And open again: the blade swings out and the handle comes home.
      { t: 2.4, ...FLAT, a: 0, b: PI, hingeEase: 'smooth' },
      { t: 2.75, ...FLAT, a: 0, b: 0, hingeEase: 'smooth' },
      { t: 3.35, ...OTHER },
      { t: 3.6, ...OTHER },
      { t: 4.4, ...REST },
    ],
  },

  m9: {
    draw: rise(0.58, { rz: -0.6, flex: 0.4 }, { rz: 0.15, flex: -0.15 }),
    idle: [
      { t: 0, ...REST },
      { t: 3, ...REST },
      { t: 3.6, rz: 0.05, flex: 0.1, ease: 'smooth' },
      { t: 4.4, rz: 0, flex: 0, ease: 'smooth' },
      { t: 6.5, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      { t: 0.14, ...DIP },
      { t: 0.62, ...FLAT },
      { t: 1.1, ...FLAT },
      // The saw back to the eye, then the blade swung out to catch the light.
      { t: 1.75, ...SPINE },
      { t: 2.25, ...SPINE },
      { t: 2.9, ...LIGHT },
      { t: 3.35, ...LIGHT },
      { t: 4.05, ...REST },
    ],
  },

  bayonet: {
    draw: rise(0.5, { rz: 0.5, flex: -0.6 }, { rz: -0.1, flex: 0.25 }, 0.9),
    idle: [
      { t: 0, ...REST },
      { t: 3.2, ...REST },
      { t: 3.8, ry: 0.06, rz: -0.04, ease: 'smooth' },
      { t: 4.6, ry: 0, rz: 0, ease: 'smooth' },
      { t: 7, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      { t: 0.12, ...part(DIP, 0.8) },
      { t: 0.5, ...FLAT },
      { t: 0.85, ...FLAT },
      { t: 1.3, ...SWUNG },
      { t: 1.6, ...SWUNG },
      { t: 2.1, ...EDGE },
      { t: 2.35, ...EDGE },
      { t: 3.15, ...OTHER },
      { t: 3.45, ...OTHER },
      { t: 4.25, ...REST },
    ],
  },

  flip: {
    draw: [
      { ...DOWN, a: PI },
      { ...REST, t: 0.22, y: -0.05, rx: 0.12, a: PI },
      { ...REST, t: 0.36, y: -0.015, rx: -0.06, rz: -0.12, flex: -0.3, a: PI },
      { ...REST, t: 0.5, y: 0.01, rx: -0.04, rz: -0.05, flex: 0.15, hingeEase: 'snap' },
      { ...REST, t: 0.72 },
    ],
    idle: [
      { t: 0, ...REST },
      { t: 2.8, ...REST },
      { t: 3.0, a: 0.07, rz: -0.03, ease: 'smooth', hingeEase: 'snap' },
      { t: 3.3, a: 0, rz: 0, ease: 'smooth' },
      { t: 6, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      { t: 0.14, ...DIP },
      { t: 0.55, ...FLAT },
      { t: 1.0, ...FLAT },
      // The thumb eases the blade shut, partway; the wrist is cocked and snaps it open again.
      { t: 1.5, ...FLAT, a: 1.6, hingeEase: 'smooth' },
      { t: 2.05, ...CANT_LEFT, a: 1.6 },
      { t: 2.5, ...FLAT, flex: -0.4, dev: 0.15, a: 1.6 },
      { t: 2.78, ...FLAT, flex: 0.25, dev: -0.08, rx: -0.2, a: 0, hingeEase: 'snap' },
      { t: 3.35, ...OTHER },
      { t: 3.65, ...OTHER },
      { t: 4.4, ...REST },
    ],
  },

  huntsman: {
    draw: rise(0.72, { flex: -0.3 }, { flex: 0.1 }, 1.7),
    idle: [
      { t: 0, ...REST },
      { t: 2.6, ...REST },
      { t: 3.3, y: 0.004, rx: -0.04, ease: 'smooth' },
      { t: 4.1, y: 0, rx: 0, ease: 'smooth' },
      { t: 6.5, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      { t: 0.18, y: -0.02, rx: 0.06 },
      { t: 0.85, ...part(FLAT, 0.8) },
      // Weighed in the hand: let down a little and taken up again.
      { t: 1.25, ...part(FLAT, 0.8), y: 0.065 },
      { t: 1.65, ...part(FLAT, 0.8), y: 0.085 },
      { t: 2.5, ...part(CANT_RIGHT, 0.8) },
      { t: 3.0, ...part(CANT_RIGHT, 0.8) },
      { t: 3.5, ...part(EDGE, 0.8) },
      { t: 3.85, ...part(EDGE, 0.8) },
      { t: 4.3, ...REST },
    ],
  },

  falchion: {
    draw: rise(0.68, { x: 0.05, dev: -0.35, rz: 0.4 }, { x: -0.03, dev: 0.1, rz: -0.15 }, 1.1),
    idle: [
      { t: 0, ...REST },
      { t: 2.4, ...REST },
      { t: 3.0, rz: -0.05, ry: 0.05, ease: 'smooth' },
      { t: 3.8, rz: 0, ry: 0, ease: 'smooth' },
      { t: 6, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      { t: 0.14, ...DIP },
      { t: 0.58, ...FLAT },
      { t: 1.05, ...FLAT },
      // Rolled over in one long sweep, to show the curve of its belly, and held.
      { t: 1.7, ...SPINE },
      { t: 2.4, ...OTHER },
      { t: 2.85, ...OTHER },
      { t: 3.5, ...BEND },
      { t: 3.85, ...BEND },
      { t: 4.35, ...REST },
    ],
  },

  gut: {
    draw: rise(0.52, { rz: 0.8, flex: -0.5 }, { rz: 0.1, flex: 0.1 }, 0.9),
    idle: [
      { t: 0, ...REST },
      { t: 3, ...REST },
      { t: 3.5, rz: 0.07, ease: 'smooth' },
      { t: 4.2, rz: 0, ease: 'smooth' },
      { t: 6.5, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      { t: 0.12, ...part(DIP, 0.8) },
      { t: 0.52, ...FLAT },
      { t: 0.95, ...FLAT },
      // The hook to the eye, then the other side.
      { t: 1.6, ...BEND },
      { t: 2.1, ...BEND },
      { t: 2.8, ...OTHER },
      { t: 3.15, ...OTHER },
      { t: 3.95, ...REST },
    ],
  },

  talon: {
    draw: rise(0.74, { rz: -0.5, flex: -0.5 }, { rz: 0.1, flex: 0.1 }),
    idle: [
      { t: 0, ...REST },
      { t: 2.6, ...REST },
      { t: 3.2, ry: 0.05, rz: -0.06, ease: 'smooth' },
      { t: 4.0, ry: 0, rz: 0, ease: 'smooth' },
      { t: 6.4, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      { t: 0.14, ...DIP },
      { t: 0.6, ...FLAT },
      { t: 1.1, ...FLAT },
      // The claw turned to the eye, and the blade pointed along the view.
      { t: 1.9, ...BEND },
      { t: 2.4, ...BEND },
      { t: 3.05, ...TIP },
      { t: 3.45, ...TIP },
      { t: 4.1, ...REST },
    ],
  },

  skeleton: {
    draw: rise(0.6, { flex: 0.5 }, { flex: -0.2 }, 0.7),
    idle: [
      { t: 0, ...REST },
      { t: 2.8, ...REST },
      { t: 3.4, ry: -0.04, rz: 0.05, ease: 'smooth' },
      { t: 4.2, ry: 0, rz: 0, ease: 'smooth' },
      { t: 6.6, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      { t: 0.1, ...part(DIP, 0.6) },
      { t: 0.45, ...FLAT },
      { t: 0.8, ...FLAT },
      // Held up to the light to see through, and canted to catch it again.
      { t: 1.3, ...LIGHT },
      { t: 1.65, ...LIGHT },
      { t: 2.2, ...CANT_LEFT },
      { t: 2.5, ...CANT_LEFT },
      { t: 3.1, ...REST },
    ],
  },

  // The stiletto's blade, closed, reaches past the butt, and sweeps through the little finger and the
  // heel of the hand as it opens: the hand loosens for the flick, which the draw does.
  stiletto: {
    through: { a: [1.75, 3.1] },
    draw: [
      { ...DOWN, a: PI },
      { ...REST, t: 0.24, y: -0.04, rx: 0.1, a: PI },
      { ...REST, t: 0.33, y: -0.015, rx: -0.04, rz: 0.05, a: PI, loose: 1 },
      { ...REST, t: 0.47, y: 0.008, rx: -0.03, rz: -0.08, flex: 0.1, loose: 1, hingeEase: 'snap' },
      { ...REST, t: 0.56, y: 0.004 },
      { ...REST, t: 0.74 },
    ],
    idle: [
      { t: 0, ...REST },
      { t: 3, ...REST },
      { t: 3.6, rz: 0.04, flex: 0.08, ease: 'smooth' },
      { t: 4.4, rz: 0, flex: 0, ease: 'smooth' },
      { t: 6.8, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      { t: 0.14, ...part(DIP, 0.7) },
      { t: 0.55, ...FLAT },
      { t: 1.0, ...FLAT },
      { t: 1.65, ...TIP },
      { t: 2.0, ...TIP },
      // The blade pressed partway back, then the spring takes it open.
      { t: 2.4, ...FLAT, a: 1.6, hingeEase: 'smooth' },
      { t: 2.65, ...FLAT, a: 1.6 },
      { t: 2.8, ...FLAT, a: 0, hingeEase: 'snap' },
      { t: 3.35, ...OTHER },
      { t: 3.6, ...OTHER },
      { t: 4.4, ...REST },
    ],
  },
};

const NO_IDLE: readonly Key[] = [{ t: 0 }];

function compile(keys: MoveKeys): KnifeMoves {
  return {
    draw: clip(keys.draw),
    redraw: clip(keys.redraw ?? retimed(keys.draw, REDRAW, SPENT)),
    idle: clip(keys.idle ?? NO_IDLE),
    inspect: clip(keys.inspect),
    rest: { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, ...keys.rest },
    through: keys.through ?? {},
  };
}

const compiled = new Map<KnifeSkin, KnifeMoves>(
  KNIFE_SKINS.map((skin) => [skin, compile(MOVES[skin])]),
);

/** How a knife moves in the hand. */
export function knifeMoves(skin: KnifeSkin): KnifeMoves {
  return compiled.get(skin)!;
}
