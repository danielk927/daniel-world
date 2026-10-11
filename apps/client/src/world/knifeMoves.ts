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

/** A key of the hinges and the fingers alone: a time, how it is arrived at, and what changes. */
export type HingeKey = { readonly t: number; readonly ease?: Ease } & {
  readonly [C in 'a' | 'b' | 'loose']?: number;
};

/** A run of channels keyed together: flat arrays, so sampling it never allocates. */
interface Track {
  /** The first channel (in CHANNELS) it has, and how many. */
  readonly first: number;
  readonly width: number;
  readonly times: Float64Array;
  /** `width` values per key. */
  readonly values: Float64Array;
  /** How fast each channel goes at each key where the motion flows through it. */
  readonly slopes: Float64Array;
  /** How each key is arrived at. */
  readonly eases: Uint8Array;
}

/**
 * A compiled clip: the arm and the wrist keyed on one track, the knife's hinges and the fingers on
 * another, so that a blade can snap open at its own moment without the hand's keys being squeezed
 * round it. Flat arrays, so sampling it never allocates.
 */
export interface Clip {
  readonly duration: number;
  readonly arm: Track;
  readonly hinge: Track;
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

/** Compile keys (in time order, the first at 0) into a track of `width` channels from `first`. */
function track(
  keys: readonly { readonly t: number; readonly [channel: string]: unknown }[],
  first: number,
  width: number,
  easeOf: (key: { readonly [channel: string]: unknown }) => Ease | undefined,
): Track {
  const times = new Float64Array(keys.length);
  const values = new Float64Array(keys.length * width);
  const eases = new Uint8Array(keys.length);
  keys.forEach((key, i) => {
    if (i > 0 && key.t <= keys[i - 1]!.t) throw new Error('keys must move forward in time');
    times[i] = key.t;
    for (let c = 0; c < width; c++) {
      const given = key[CHANNELS[first + c]!];
      values[i * width + c] =
        typeof given === 'number' ? given : i > 0 ? values[(i - 1) * width + c]! : 0;
    }
    eases[i] = EASES.indexOf(easeOf(key) ?? 'flow');
  });
  // A channel flows through a key only if the curve is the flowing one on both sides of it.
  const slopes = new Float64Array(keys.length * width);
  for (let i = 1; i < keys.length - 1; i++) {
    if (eases[i] !== FLOW || eases[i + 1] !== FLOW) continue;
    for (let c = 0; c < width; c++) slopes[i * width + c] = flowSlope(times, values, width, i, c);
  }
  return { first, width, times, values, slopes, eases };
}

/**
 * Compile keys (in time order, the first at 0) into a clip. Channels not keyed start at 0. The
 * hinges and the fingers follow the same keys, unless `hinges` keys them on their own.
 */
export function clip(keys: readonly Key[], hinges?: readonly HingeKey[]): Clip {
  const arm = track(keys, 0, HINGES, (key) => key.ease as Ease | undefined);
  const hinge = hinges
    ? track(hinges, HINGES, CHANNELS.length - HINGES, (key) => key.ease as Ease | undefined)
    : track(
        keys,
        HINGES,
        CHANNELS.length - HINGES,
        (key) => (key.hingeEase ?? key.ease) as Ease | undefined,
      );
  const end = (t: Track): number => t.times[t.times.length - 1]!;
  return { duration: Math.max(end(arm), end(hinge)), arm, hinge };
}

/** Sample one track `t` seconds in into `out`. Past its last key it holds it. */
function sampleTrack(tr: Track, t: number, out: ArmPose): void {
  const { first, width, times, values, slopes, eases } = tr;
  const last = times.length - 1;
  if (last === 0 || t >= times[last]!) {
    for (let c = 0; c < width; c++) out[CHANNELS[first + c]!] = values[last * width + c]!;
    return;
  }
  let i = 0;
  while (i < last - 1 && t >= times[i + 1]!) i++;
  const t0 = times[i]!;
  const h = times[i + 1]! - t0;
  const k = Math.max(0, Math.min(1, (t - t0) / h));
  const kind = eases[i + 1]!;
  for (let c = 0; c < width; c++) {
    const a = values[i * width + c]!;
    const b = values[(i + 1) * width + c]!;
    if (kind === FLOW) {
      // A quintic Hermite curve through both keys, at the speeds flowing through them and with no
      // acceleration at either, so that the acceleration is the same either side of every key.
      const k3 = k * k * k;
      const k4 = k3 * k;
      const k5 = k4 * k;
      out[CHANNELS[first + c]!] =
        (1 - 10 * k3 + 15 * k4 - 6 * k5) * a +
        (k - 6 * k3 + 8 * k4 - 3 * k5) * h * slopes[i * width + c]! +
        (10 * k3 - 15 * k4 + 6 * k5) * b +
        (-4 * k3 + 7 * k4 - 3 * k5) * h * slopes[(i + 1) * width + c]!;
    } else {
      out[CHANNELS[first + c]!] = a + (b - a) * ease(kind, k);
    }
  }
}

/** The pose `t` seconds into a clip. Past its end it holds its last key. */
export function sample(c: Clip, t: number, out: ArmPose): ArmPose {
  out.knife = true;
  sampleTrack(c.arm, t, out);
  sampleTrack(c.hinge, t, out);
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
  /** The hinges and the fingers' own keys through the inspect, if they are not the arm's. */
  inspectHinges?: readonly HingeKey[];
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

/** Some of a pose's channels. */
type Pose = { readonly [C in Channel]?: number };

/**
 * Where the hand takes each knife to show it, as offsets from rest, each found by searching what a
 * wrist and a forearm reach (`viewmodelGrounded.test.ts` holds every clip to their range) for a view
 * of the knife: the arm brings it up, across and near, so the blade fills a good part of the view
 * and its middle is near the middle of it, and the forearm rolls and the wrist flexes to turn it.
 * One flat of a blade is seen from the palm's side at rest; the other is seen only from the back of
 * the hand, with the fingers reaching toward the eye, the fist low and the blade above it.
 */
const FWD = {
  /** The flat the knife rests showing, face on. */
  flat: { x: -0.08, y: 0.14, z: 0.12, rx: 0.18, ry: 0.03, rz: 0.08, flex: 0.27, dev: 0.18 },
  /** The same, rolled a little to tilt the blade across the view. */
  turn: { x: -0.08, y: 0.14, z: 0.12, rx: 0.18, ry: 0.03, rz: 0.6, flex: 0.1, dev: 0.18 },
  /** The other flat, face on. */
  other: { x: -0.15, y: 0.14, z: 0.1, rx: 0.54, ry: -0.56, rz: 1.25, flex: -0.95, dev: 0 },
  /** The spine up, from the back of the hand. */
  spine: { x: -0.1, y: 0.14, z: 0.1, rx: -0.1, ry: -0.3, rz: 0.9, flex: -0.5, dev: 0.2 },
  /** The edge toward the eye. */
  edge: { x: -0.1, y: 0.14, z: 0.1, rx: 0.06, ry: 0.11, rz: -0.48, flex: 0.96, dev: 0.15 },
  /** Looking along the blade, its tip toward the eye. */
  look: { x: -0.06, y: 0.12, z: 0.1, rx: 0.35, ry: 0.2, rz: 0.5, flex: 0.1, dev: 0.3 },
} as const satisfies Record<string, Pose>;
/** The chef's knife, held edge on and blade up, which the forearm and wrist turn the same way. */
const CHEF = {
  flat: { x: -0.09, y: 0.12, z: 0.11, rx: -0.09, ry: 0.13, rz: -0.22, flex: 0.51, dev: 0.14 },
  spine: { x: -0.11, y: 0.12, z: 0.12, rx: 0.08, ry: -0.23, rz: 0.03, flex: -0.13, dev: 0.23 },
  other: { x: -0.12, y: 0.12, z: 0.09, rx: 0.3, ry: -0.46, rz: 1.08, flex: -0.95, dev: 0.09 },
} as const satisfies Record<string, Pose>;
/** The karambit, held with its ring on the index finger and its claw out of the fist's heel. */
const CLAW = {
  /** The claw's flat, seen from the palm's side. */
  flat: { x: -0.06, y: 0.14, z: 0.13, rx: 0.04, ry: -0.04, rz: -0.19, flex: 0.02, dev: 0.21 },
  /** Its other side, seen from the back of the hand, the wrist bent right over. */
  other: { x: -0.07, y: 0.13, z: 0.12, rx: 0.41, ry: 0.7, rz: 0.47, flex: 1, dev: 0.35 },
  /** The edge of the claw's inside curve to the eye. */
  edge: { x: -0.07, y: 0.16, z: 0.14, rx: 0.24, ry: 0.25, rz: -0.29, flex: 0.7, dev: 0.14 },
} as const satisfies Record<string, Pose>;
/** A hand's small dip before it lifts, so the lift has something to push off. */
const DIP = { y: -0.012, rx: 0.04 } as const satisfies Pose;

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

/** The arm and wrist's channels, which a beat of an inspect sets and a drift settles. */
const ARM_CHANNELS = CHANNELS.slice(0, HINGES);
const ARM_AT_REST = Object.fromEntries(ARM_CHANNELS.map((c) => [c, 0])) as Pose;

/** A pose to show: arrive at `at` seconds, stay `hold` seconds, and go on. */
interface Beat {
  readonly at: number;
  /** The arm and the wrist; any channel not given is at rest. */
  readonly pose: Pose;
  readonly hold?: number;
  /** How far toward the next pose the hand has settled by the end of the hold (a tenth). */
  readonly drift?: number;
  readonly ease?: Ease;
}

/**
 * An inspect from the poses it shows, in order, the last back at rest. A hold is never a stop: the
 * hand leaves a pose a little on toward the next, as one settles and begins to move on, so the
 * motion slows into a pose, creeps on through it, and picks up again, the way a hand does and a
 * pose held between two stops does not.
 */
function inspectOf(beats: readonly Beat[]): readonly Key[] {
  const keys: Key[] = [{ t: 0, ...ARM_AT_REST }];
  beats.forEach((beat, i) => {
    const next = beats[i + 1]?.pose ?? ARM_AT_REST;
    keys.push({
      ...ARM_AT_REST,
      ...beat.pose,
      t: beat.at,
      ...(beat.ease ? { ease: beat.ease } : {}),
    });
    if (!beat.hold) return;
    const settled = Object.fromEntries(
      ARM_CHANNELS.map((c) => {
        const from = beat.pose[c] ?? 0;
        return [c, from + ((next[c] ?? 0) - from) * (beat.drift ?? 0.1)];
      }),
    );
    keys.push({ ...settled, t: beat.at + beat.hold });
  });
  return keys;
}

/**
 * A hinge swung to its stop from `from` at `t`: it goes at once and hits the stop, bounces back a
 * little and settles, as a blade or a handle swung by the wrist does.
 */
function swing(
  channel: 'a' | 'b',
  t: number,
  from: number,
  to: number,
  over = 0.17,
  bounce = 0.13,
): readonly HingeKey[] {
  const back = to - Math.sign(to - from) * bounce;
  return [
    { t, [channel]: from },
    { t: t + over, [channel]: to, ease: 'snap' },
    { t: t + over + 0.11, [channel]: back, ease: 'smooth' },
    { t: t + over + 0.26, [channel]: to, ease: 'smooth' },
  ];
}

/** A hinge pressed slowly from `from` to `to` over `over` seconds from `t`, by the thumb. */
function press(
  channel: 'a' | 'b',
  t: number,
  from: number,
  to: number,
  over = 0.5,
): readonly HingeKey[] {
  return [
    { t, [channel]: from },
    { t: t + over, [channel]: to, ease: 'smooth' },
  ];
}

/** Hinge keys from runs of them, in time order, the first at 0 and what is not keyed at rest. */
function hinges(...runs: (readonly HingeKey[])[]): readonly HingeKey[] {
  return [{ t: 0, a: 0, b: 0, loose: 0 }, ...runs.flat()];
}

const MOVES: Readonly<Record<KnifeSkin, MoveKeys>> = {
  kitchen: {
    draw: rise(0.55, {}, {}, 1.2),
    inspect: inspectOf([
      { at: 0.24, pose: DIP },
      { at: 0.85, pose: part(CHEF.flat, 0.55) },
      { at: 1.4, pose: CHEF.flat, hold: 0.35 },
      { at: 2.2, pose: CHEF.spine },
      { at: 2.85, pose: CHEF.other, hold: 0.35 },
      { at: 3.65, pose: part(CHEF.spine, 0.45) },
      { at: 4.3, pose: {} },
    ]),
  },

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
    inspect: inspectOf([
      { at: 0.2, pose: DIP },
      { at: 0.8, pose: part(CLAW.flat, 0.6) },
      { at: 1.4, pose: CLAW.flat, hold: 0.4 },
      { at: 2.25, pose: CLAW.edge, hold: 0.25 },
      { at: 3.05, pose: CLAW.other, hold: 0.3 },
      { at: 3.85, pose: part(CLAW.flat, 0.5) },
      { at: 4.35, pose: {} },
    ]),
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
    inspect: inspectOf([
      { at: 0.14, pose: DIP },
      { at: 0.7, pose: FWD.flat, hold: 0.3 },
      { at: 1.5, pose: FWD.turn, hold: 0.25 },
      { at: 2.3, pose: FWD.spine },
      { at: 3.0, pose: FWD.flat },
      { at: 3.55, pose: FWD.other, hold: 0.3 },
      { at: 4.4, pose: {} },
    ]),
    inspectHinges: hinges(
      swing('b', 1.2, 0, PI),
      swing('a', 1.8, 0, -PI, 0.2, 0.12),
      swing('a', 2.5, -PI, 0, 0.2, 0.12),
      swing('b', 3.0, PI, 0),
    ),
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
    inspect: inspectOf([
      { at: 0.16, pose: DIP },
      { at: 0.7, pose: FWD.flat, hold: 0.4 },
      { at: 1.65, pose: FWD.spine, hold: 0.3 },
      { at: 2.55, pose: FWD.other, hold: 0.3 },
      { at: 3.4, pose: FWD.look },
      { at: 4.25, pose: {} },
    ]),
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
    inspect: inspectOf([
      { at: 0.1, pose: part(DIP, 0.6) },
      { at: 0.65, pose: FWD.look, hold: 0.2 },
      { at: 1.35, pose: FWD.flat, hold: 0.3 },
      { at: 2.15, pose: FWD.other, hold: 0.3 },
      { at: 3.2, pose: FWD.edge },
      { at: 3.95, pose: {} },
    ]),
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
    inspect: inspectOf([
      { at: 0.14, pose: DIP },
      { at: 0.7, pose: FWD.flat, hold: 0.3 },
      { at: 1.4, pose: FWD.turn, hold: 0.3 },
      { at: 2.15, pose: FWD.spine },
      { at: 2.55, pose: { ...FWD.turn, flex: -0.1, dev: 0.1 } },
      { at: 2.88, pose: { ...FWD.flat, flex: 0.3 } },
      { at: 3.6, pose: FWD.other, hold: 0.4 },
      { at: 4.45, pose: {} },
    ]),
    inspectHinges: hinges(press('a', 1.2, 0, 1.6, 0.6), swing('a', 2.65, 1.6, 0, 0.1, 0.1)),
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
    inspect: inspectOf([
      { at: 0.3, pose: { y: -0.025, rx: 0.07 } },
      { at: 1.0, pose: part(FWD.flat, 0.9), hold: 0.4, drift: 0.25 },
      // Weighed: let down in the hand, and taken up again, past where it was.
      { at: 1.8, pose: { ...part(FWD.flat, 0.9), y: 0.09, z: 0.09, rx: 0.28 } },
      { at: 2.5, pose: { ...part(FWD.flat, 0.9), y: 0.15 }, hold: 0.3, drift: 0.25 },
      { at: 3.35, pose: part(FWD.other, 0.9), hold: 0.35, drift: 0.2 },
      { at: 4.45, pose: {} },
    ]),
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
    inspect: inspectOf([
      { at: 0.14, pose: DIP },
      { at: 0.7, pose: FWD.turn },
      { at: 1.65, pose: FWD.other, hold: 0.5 },
      { at: 2.75, pose: FWD.flat, hold: 0.4 },
      { at: 3.7, pose: FWD.look },
      { at: 4.4, pose: {} },
    ]),
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
    inspect: inspectOf([
      { at: 0.12, pose: DIP },
      // The hook, on its spine, first; then the flat, and the other side.
      { at: 0.75, pose: FWD.spine, hold: 0.4 },
      { at: 1.65, pose: FWD.flat, hold: 0.35 },
      { at: 2.6, pose: FWD.other, hold: 0.4 },
      { at: 3.95, pose: {} },
    ]),
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
    inspect: inspectOf([
      { at: 0.14, pose: DIP },
      { at: 0.7, pose: FWD.turn },
      { at: 1.35, pose: FWD.flat, hold: 0.4 },
      { at: 2.35, pose: FWD.other, hold: 0.3 },
      { at: 3.4, pose: FWD.look },
      { at: 4.25, pose: {} },
    ]),
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
    inspect: inspectOf([
      { at: 0.1, pose: part(DIP, 0.6) },
      { at: 0.6, pose: FWD.flat, hold: 0.3 },
      { at: 1.45, pose: FWD.other, hold: 0.4 },
      { at: 2.5, pose: FWD.flat },
      { at: 3.4, pose: {} },
    ]),
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
    inspect: inspectOf([
      { at: 0.14, pose: DIP },
      { at: 0.7, pose: FWD.flat, hold: 0.3 },
      { at: 1.4, pose: FWD.look, hold: 0.3 },
      { at: 2.25, pose: FWD.turn, hold: 0.35 },
      { at: 3.05, pose: FWD.flat },
      { at: 3.65, pose: FWD.other, hold: 0.25 },
      { at: 4.45, pose: {} },
    ]),
    inspectHinges: hinges(press('a', 1.95, 0, 1.6), swing('a', 2.75, 1.6, 0, 0.1, 0.06)),
  },
};

const NO_IDLE: readonly Key[] = [{ t: 0 }];

function compile(keys: MoveKeys): KnifeMoves {
  return {
    draw: clip(keys.draw),
    redraw: clip(keys.redraw ?? retimed(keys.draw, REDRAW, SPENT)),
    idle: clip(keys.idle ?? NO_IDLE),
    inspect: clip(keys.inspect, keys.inspectHinges),
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
