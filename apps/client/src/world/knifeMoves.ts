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
  /** The knife turned about its own length, through the grip. */
  spin: number;
  /** The knife turned end over end, in the plane of its blade, about its pivot (a finger ring). */
  flip: number;
  /** The knife's own moving parts: a folding blade, a butterfly's blade and its free handle. */
  a: number;
  b: number;
  /**
   * How far the knife has slid from being gripped by its handle (0) to hanging from its pivot (1),
   * as a knife spun on a finger through its ring hangs from the ring.
   */
  hang: number;
}

/** Every channel a clip can key, in the order they are stored. */
export const CHANNELS = [
  'x',
  'y',
  'z',
  'rx',
  'ry',
  'rz',
  'spin',
  'flip',
  'a',
  'b',
  'hang',
] as const;
export type Channel = (typeof CHANNELS)[number];
/** Channels that turn something, which wrap: a whole turn is the same as none. */
const TURNS: readonly Channel[] = ['spin', 'flip', 'a', 'b'];
/** The first channel that moves the knife rather than the arm. */
const KNIFE_CHANNELS = CHANNELS.indexOf('spin');

/**
 * How a key is arrived at: `smooth` eases in and out (the hand moves, then settles), `linear` keeps
 * a spin going through it, `in` and `out` accelerate or decelerate, `back` overshoots a little and
 * settles, like a hand snapping into place.
 */
export type Ease = 'smooth' | 'linear' | 'in' | 'out' | 'back' | 'sine';
const EASES: readonly Ease[] = ['smooth', 'linear', 'in', 'out', 'back', 'sine'];

export const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
export const easeInCubic = (t: number): number => t * t * t;
export const easeInOutCubic = (t: number): number =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
/** Overshoots a little and settles, like a hand snapping into place. */
export const easeOutBack = (t: number): number => {
  const c = 1.7;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};

function ease(kind: number, t: number): number {
  switch (kind) {
    case 1:
      return t;
    case 2:
      return easeInCubic(t);
    case 3:
      return easeOutCubic(t);
    case 4:
      return easeOutBack(t);
    case 5:
      return 0.5 - 0.5 * Math.cos(Math.PI * t);
    default:
      return easeInOutCubic(t);
  }
}

/** A key: a time, and any channels that change there; the rest carry on from the key before. */
export type Key = { readonly t: number; readonly ease?: Ease; readonly knifeEase?: Ease } & {
  readonly [C in Channel]?: number;
};

/** A compiled clip: flat arrays, so sampling it never allocates. */
export interface Clip {
  readonly duration: number;
  readonly times: Float64Array;
  /** CHANNELS.length values per key. */
  readonly values: Float64Array;
  /** How each key is arrived at, for the arm and for the knife. */
  readonly armEase: Uint8Array;
  readonly knifeEase: Uint8Array;
}

/** Compile keys (in time order, the first at 0) into a clip. Channels not keyed start at 0. */
export function clip(keys: readonly Key[]): Clip {
  const n = CHANNELS.length;
  const times = new Float64Array(keys.length);
  const values = new Float64Array(keys.length * n);
  const armEase = new Uint8Array(keys.length);
  const knifeEase = new Uint8Array(keys.length);
  keys.forEach((key, i) => {
    if (i > 0 && key.t <= keys[i - 1]!.t) throw new Error('keys must move forward in time');
    times[i] = key.t;
    CHANNELS.forEach((channel, c) => {
      values[i * n + c] = key[channel] ?? (i > 0 ? values[(i - 1) * n + c]! : 0);
    });
    armEase[i] = EASES.indexOf(key.ease ?? 'smooth');
    knifeEase[i] = EASES.indexOf(key.knifeEase ?? key.ease ?? 'smooth');
  });
  return { duration: keys[keys.length - 1]!.t, times, values, armEase, knifeEase };
}

/** Wrap an angle into (-π, π]. */
function wrap(angle: number): number {
  return angle - Math.PI * 2 * Math.round(angle / (Math.PI * 2));
}

/** The pose `t` seconds into a clip. Past its end it holds its last key, turns unwound. */
export function sample(c: Clip, t: number, out: ArmPose): ArmPose {
  const n = CHANNELS.length;
  const last = c.times.length - 1;
  out.knife = true;
  if (last === 0 || t >= c.duration) {
    for (let ch = 0; ch < n; ch++) out[CHANNELS[ch]!] = c.values[last * n + ch]!;
    for (const turn of TURNS) out[turn] = wrap(out[turn]);
    return out;
  }
  let i = 0;
  while (i < last - 1 && t >= c.times[i + 1]!) i++;
  const t0 = c.times[i]!;
  const span = c.times[i + 1]! - t0;
  const k = Math.max(0, Math.min(1, (t - t0) / span));
  const armK = ease(c.armEase[i + 1]!, k);
  const knifeK = ease(c.knifeEase[i + 1]!, k);
  for (let ch = 0; ch < n; ch++) {
    const a = c.values[i * n + ch]!;
    const b = c.values[(i + 1) * n + ch]!;
    out[CHANNELS[ch]!] = a + (b - a) * (ch < KNIFE_CHANNELS ? armK : knifeK);
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
const TAU = Math.PI * 2;
const PI = Math.PI;

interface MoveKeys {
  draw: readonly Key[];
  /** Defaults to the draw, quickened to fit and started from where a throw leaves the arm. */
  redraw?: readonly Key[];
  idle?: readonly Key[];
  inspect: readonly Key[];
  rest?: Partial<Offset>;
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
  spin: 0,
  flip: 0,
  a: 0,
  b: 0,
  hang: 0,
} as const;

const MOVES: Readonly<Record<KnifeSkin, MoveKeys>> = {
  // The chef's knife: up from below with a snap, and a long look turning it over (DECISIONS.md).
  kitchen: {
    draw: [DOWN, { t: 0.22, ...REST, ease: 'back' }],
    redraw: [
      { t: 0, ...SPENT, spin: TAU },
      { t: REDRAW, ...REST, ease: 'back', knifeEase: 'out' },
    ],
    inspect: [
      { t: 0, ...REST },
      { t: 0.5, x: -0.07, y: 0.07, z: 0.05, rx: -0.1, ry: 0, rz: 1.2, spin: PI / 2 },
      { t: 1.15, x: -0.075, y: 0.072, z: 0.055, rx: -0.14, ry: 0.05, rz: 1.28, spin: PI / 2 + 0.1 },
      { t: 1.6, x: -0.07, y: 0.07, z: 0.05, rx: -0.1, ry: 0, rz: 1.2, spin: (PI * 3) / 2 },
      { t: 2.05, x: -0.06, y: 0.075, z: 0.05, rx: -0.3, ry: 0, rz: 0.7, spin: (PI * 3) / 2 + 0.1 },
      { t: 2.6, ...REST, spin: TAU },
    ],
  },

  // The karambit spins round the finger in its ring, on the draw and twice over on the inspect.
  karambit: {
    rest: { y: 0.05 },
    draw: [
      { ...DOWN, flip: -TAU * 2 },
      { t: 0.25, y: -0.04, rx: 0.1, flip: -TAU * 0.9, ease: 'out', knifeEase: 'linear' },
      { t: 0.62, ...REST, flip: 0, ease: 'smooth', knifeEase: 'out' },
    ],
    idle: [
      { t: 0, ...REST },
      { t: 2.2, ...REST },
      { t: 2.8, rz: 0.06, flip: -0.18, ease: 'sine' },
      { t: 3.6, rz: 0, flip: 0, ease: 'sine' },
      { t: 6, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      // Swing the claw up over the ring and hold it up to the light...
      { t: 0.5, x: -0.04, y: 0.05, z: 0.01, rx: -0.1, ry: 0.1, rz: 0.15, flip: -PI },
      { t: 1.15, x: -0.045, y: 0.056, rx: -0.15, ry: 0.24, rz: 0.32, flip: -PI - 0.14 },
      // ...then let it spin twice round the finger, and catch it.
      {
        t: 1.35,
        x: -0.035,
        y: 0.045,
        rx: -0.05,
        ry: 0.1,
        rz: 0.15,
        flip: -PI - 0.7,
        knifeEase: 'in',
      },
      { t: 2.0, flip: -PI - TAU * 2 + 0.3, knifeEase: 'linear' },
      { t: 2.25, x: -0.03, y: 0.04, flip: -PI - TAU * 2, knifeEase: 'out' },
      { t: 2.95, ...REST, flip: -TAU * 3 },
    ],
  },

  // The butterfly rises closed and flips open, and its inspect is a flipping routine.
  butterfly: {
    draw: [
      { ...DOWN, spin: 0, a: PI, b: PI },
      { t: 0.18, y: -0.06, rx: 0.15, a: PI, b: PI, ease: 'out' },
      // The free handle swings away with the blade, then back round to close on the grip.
      { t: 0.36, y: 0.01, rx: -0.05, rz: 0.15, a: 0, b: PI, knifeEase: 'in' },
      { t: 0.56, y: 0, rx: 0, rz: 0, a: 0, b: 0, knifeEase: 'out' },
      { t: 0.72, ...REST, ease: 'back' },
    ],
    idle: [
      { t: 0, ...REST },
      { t: 2.5, ...REST },
      { t: 2.75, b: 0.35, rz: 0.04, ease: 'sine', knifeEase: 'out' },
      { t: 3.05, b: 0, rz: 0, ease: 'sine', knifeEase: 'in' },
      { t: 5.5, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      { t: 0.35, x: -0.07, y: 0.08, z: 0.02, rx: -0.12, rz: 0.35 },
      // Closed: the free handle swings round over the edge, then the blade folds into the grip.
      { t: 0.58, b: PI, knifeEase: 'in' },
      { t: 0.78, a: PI, b: PI, rz: 0.2, knifeEase: 'out' },
      // Open again as the wrist turns over: the blade swings out, then the handle comes home.
      { t: 1.02, x: -0.075, y: 0.085, a: 0, spin: PI, rz: 0.5, knifeEase: 'in' },
      { t: 1.24, b: 0, spin: TAU, knifeEase: 'out' },
      // An aerial: the whole knife tossed round the grip once.
      { t: 1.45, x: -0.07, y: 0.09, rz: 0.3, flip: 0 },
      { t: 1.95, x: -0.07, y: 0.12, rz: 0.2, flip: -TAU, knifeEase: 'smooth' },
      // And a look along the open blade.
      { t: 2.45, x: -0.07, y: 0.07, z: 0.04, rx: -0.15, ry: 0.2, rz: 1.05, spin: TAU + PI / 2 },
      { t: 3.05, x: -0.072, y: 0.072, rz: 1.12, spin: TAU + PI / 2 + 0.1 },
      { t: 3.65, ...REST, flip: -TAU, spin: TAU * 2 },
    ],
  },

  // The M9 rolls in the fingers as it comes up, and its inspect is a wrist roll and a spin.
  m9: {
    draw: [
      { ...DOWN, spin: -TAU },
      { t: 0.3, y: -0.02, rx: 0.05, spin: -PI * 0.3, knifeEase: 'linear' },
      { t: 0.55, ...REST, ease: 'back', knifeEase: 'out' },
    ],
    idle: [
      { t: 0, ...REST },
      { t: 3, ...REST },
      { t: 3.6, rz: 0.05, spin: 0.12, ease: 'sine' },
      { t: 4.4, rz: 0, spin: 0, ease: 'sine' },
      { t: 6.5, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      { t: 0.5, x: -0.07, y: 0.07, z: 0.05, rx: -0.1, rz: 1.2, spin: PI / 2 },
      { t: 1.1, x: -0.074, y: 0.072, z: 0.055, rx: -0.14, ry: 0.05, rz: 1.26, spin: PI / 2 + 0.08 },
      { t: 1.55, x: -0.07, y: 0.07, z: 0.05, rx: -0.1, ry: 0, rz: 1.2, spin: (PI * 3) / 2 },
      // Tip it up, then spin it round the fingers end over end.
      { t: 1.95, x: -0.05, y: 0.06, z: 0.03, rx: -0.3, rz: 0.5, spin: TAU, flip: 0 },
      { t: 2.55, x: -0.03, y: 0.05, rz: 0.3, flip: TAU, knifeEase: 'smooth' },
      { t: 3.1, ...REST, spin: TAU, flip: TAU },
    ],
  },

  // The bayonet flips end over end about the fingers, the trick it is known for.
  bayonet: {
    draw: [
      { ...DOWN, flip: TAU },
      { t: 0.28, y: -0.03, rx: 0.08, flip: TAU * 0.25, knifeEase: 'linear' },
      { t: 0.55, ...REST, ease: 'back', knifeEase: 'out' },
    ],
    idle: [
      { t: 0, ...REST },
      { t: 3.2, ...REST },
      { t: 3.8, ry: 0.06, rz: -0.04, ease: 'sine' },
      { t: 4.6, ry: 0, rz: 0, ease: 'sine' },
      { t: 7, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      { t: 0.35, x: -0.03, y: 0.05, z: -0.02, rx: -0.1, rz: 0.25 },
      // Twice round the finger.
      { t: 0.95, flip: TAU, knifeEase: 'smooth' },
      { t: 1.45, flip: TAU * 2, knifeEase: 'smooth' },
      // Then a long look at the flat.
      { t: 1.95, x: -0.07, y: 0.07, z: 0.05, rx: -0.1, rz: 1.2, spin: PI / 2 },
      { t: 2.5, x: -0.074, y: 0.072, rz: 1.25, spin: PI / 2 + 0.1 },
      { t: 2.95, x: -0.07, y: 0.07, rz: 1.2, spin: (PI * 3) / 2 },
      { t: 3.5, ...REST, spin: TAU, flip: TAU * 2 },
    ],
  },

  // The flip knife comes up closed and flicks open; its inspect folds it and flicks it again.
  flip: {
    draw: [
      { ...DOWN, a: PI },
      { t: 0.22, y: -0.05, rx: 0.12, a: PI, ease: 'out' },
      { t: 0.32, y: -0.02, rx: -0.08, rz: -0.1, a: 0.2, knifeEase: 'in' },
      { t: 0.4, a: 0, knifeEase: 'out' },
      { t: 0.6, ...REST, ease: 'back' },
    ],
    idle: [
      { t: 0, ...REST },
      { t: 2.8, ...REST },
      { t: 3.0, a: 0.07, rz: -0.03, ease: 'sine', knifeEase: 'out' },
      { t: 3.25, a: 0, rz: 0, ease: 'sine', knifeEase: 'in' },
      { t: 6, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      { t: 0.45, x: -0.06, y: 0.06, z: 0.04, rx: -0.1, rz: 1.1, spin: PI / 2 },
      { t: 1.0, x: -0.065, y: 0.065, rz: 1.18, spin: PI / 2 + 0.1 },
      // Fold it shut...
      { t: 1.35, x: -0.04, y: 0.04, rz: 0.6, spin: PI / 4, a: PI, knifeEase: 'smooth' },
      { t: 1.6, a: PI },
      // ...and flick it open, the wrist snapping.
      { t: 1.72, rx: -0.12, rz: 0.4, a: 0, knifeEase: 'out' },
      { t: 2.1, x: -0.07, y: 0.07, z: 0.04, rx: -0.12, rz: 1.2, spin: (PI * 3) / 2 },
      { t: 2.55, x: -0.072, y: 0.072, rz: 1.24, spin: (PI * 3) / 2 + 0.1 },
      { t: 3.1, ...REST, spin: TAU },
    ],
  },

  // The huntsman turns end over end in the palm as it is drawn, and is weighed in the hand.
  huntsman: {
    draw: [
      { ...DOWN, flip: -TAU },
      { t: 0.3, y: -0.02, rx: 0.06, flip: -0.6, knifeEase: 'linear' },
      { t: 0.6, ...REST, ease: 'back', knifeEase: 'out' },
    ],
    idle: [
      { t: 0, ...REST },
      { t: 2.6, ...REST },
      { t: 3.3, y: 0.004, rx: -0.04, ease: 'sine' },
      { t: 4.1, y: 0, rx: 0, ease: 'sine' },
      { t: 6.5, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      { t: 0.5, x: -0.07, y: 0.065, z: 0.05, rx: -0.1, rz: 1.15, spin: PI / 2 },
      { t: 1.2, x: -0.072, y: 0.068, rz: 1.22, spin: PI / 2 + 0.1 },
      // Tossed up, it turns over once and is caught.
      { t: 1.5, x: -0.05, y: 0.05, rz: 0.6, spin: PI / 2, flip: 0 },
      { t: 1.85, y: 0.11, flip: -PI, knifeEase: 'linear', ease: 'out' },
      { t: 2.2, y: 0.05, flip: -TAU, knifeEase: 'linear', ease: 'in' },
      {
        t: 2.55,
        x: -0.07,
        y: 0.07,
        rz: 1.2,
        spin: (PI * 3) / 2,
        ease: 'smooth',
        knifeEase: 'smooth',
      },
      { t: 3.0, x: -0.072, y: 0.072, rz: 1.25, spin: (PI * 3) / 2 + 0.1 },
      { t: 3.5, ...REST, spin: TAU, flip: -TAU },
    ],
  },

  // The falchion rolls over the back of the hand, its signature flourish.
  falchion: {
    draw: [
      { ...DOWN, spin: TAU, flip: -PI },
      { t: 0.3, y: -0.03, rx: 0.06, spin: PI * 0.4, flip: -0.4, knifeEase: 'linear' },
      { t: 0.62, ...REST, ease: 'back', knifeEase: 'out' },
    ],
    idle: [
      { t: 0, ...REST },
      { t: 2.4, ...REST },
      { t: 3.0, rz: -0.05, ry: 0.05, ease: 'sine' },
      { t: 3.8, rz: 0, ry: 0, ease: 'sine' },
      { t: 6, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      { t: 0.45, x: -0.05, y: 0.06, z: 0.02, rx: -0.15, rz: 0.4 },
      // Over the back of the hand and round.
      { t: 1.05, x: -0.06, y: 0.08, rz: 0.7, spin: PI, flip: -PI, knifeEase: 'in' },
      { t: 1.55, x: -0.05, y: 0.06, rz: 0.4, spin: TAU, flip: -TAU, knifeEase: 'out' },
      { t: 2.05, x: -0.07, y: 0.07, z: 0.05, rx: -0.1, rz: 1.2, spin: TAU + PI / 2 },
      { t: 2.6, x: -0.074, y: 0.072, rz: 1.25, spin: TAU + PI / 2 + 0.1 },
      { t: 3.0, x: -0.07, y: 0.07, rz: 1.2, spin: TAU + (PI * 3) / 2 },
      { t: 3.5, ...REST, spin: TAU * 2, flip: -TAU },
    ],
  },

  // The gut knife twists quickly into the hand and shows off its hook from both sides.
  gut: {
    draw: [
      { ...DOWN, spin: TAU },
      { t: 0.25, y: -0.03, rx: 0.08, spin: PI * 0.3, knifeEase: 'linear' },
      { t: 0.5, ...REST, ease: 'back', knifeEase: 'out' },
    ],
    idle: [
      { t: 0, ...REST },
      { t: 3, ...REST },
      { t: 3.5, rz: 0.07, ease: 'sine' },
      { t: 4.2, rz: 0, ease: 'sine' },
      { t: 6.5, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      // The hook to the eye, then the other side.
      { t: 0.45, x: -0.06, y: 0.07, z: 0.04, rx: -0.2, ry: 0.3, rz: 1.0, spin: PI / 2 },
      { t: 1.1, x: -0.062, y: 0.074, rx: -0.25, ry: 0.35, rz: 1.05, spin: PI / 2 + 0.1 },
      { t: 1.5, x: -0.06, y: 0.07, rx: -0.2, ry: -0.2, rz: 1.0, spin: (PI * 3) / 2 },
      { t: 2.1, x: -0.062, y: 0.072, ry: -0.25, rz: 1.05, spin: (PI * 3) / 2 + 0.1 },
      // A quick twirl about its length and home.
      {
        t: 2.45,
        x: -0.03,
        y: 0.04,
        rx: -0.1,
        ry: 0,
        rz: 0.4,
        spin: TAU * 1.5,
        knifeEase: 'linear',
      },
      { t: 2.9, ...REST, spin: TAU * 2, knifeEase: 'out' },
    ],
  },

  // The talon spins on its ring the other way from the karambit, and is turned to show the claw.
  talon: {
    draw: [
      // Spun up hanging from its ring, then caught by the handle.
      { ...DOWN, flip: TAU * 1.5, hang: 1 },
      { t: 0.3, y: -0.02, rx: 0.06, flip: TAU * 0.35, ease: 'out', knifeEase: 'linear' },
      { t: 0.66, ...REST, flip: 0, hang: 0, knifeEase: 'out' },
    ],
    idle: [
      { t: 0, ...REST },
      { t: 2.6, ...REST },
      { t: 3.2, rz: -0.05, flip: 0.15, ease: 'sine' },
      { t: 4.0, rz: 0, flip: 0, ease: 'sine' },
      { t: 6.4, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      // Turned over to show the claw...
      { t: 0.45, x: -0.06, y: 0.06, z: 0.03, rx: -0.15, ry: 0.3, rz: 0.85, spin: 0.25 },
      { t: 1.05, x: -0.064, y: 0.064, ry: 0.36, rz: 0.95, spin: 0.4 },
      // ...then let slide to hang from the ring, spun twice round the finger, and caught.
      {
        t: 1.35,
        x: -0.04,
        y: 0.07,
        rx: -0.05,
        ry: 0.1,
        rz: 0.3,
        spin: 0,
        flip: 0.5,
        hang: 1,
        knifeEase: 'in',
      },
      { t: 1.95, flip: TAU * 1.5, knifeEase: 'linear' },
      { t: 2.25, x: -0.03, y: 0.05, rz: 0.15, flip: TAU * 2, knifeEase: 'out' },
      { t: 2.85, ...REST, flip: TAU * 2 },
    ],
  },

  // The skeleton knife spins on the loop at its butt.
  skeleton: {
    draw: [
      // Spun up on the finger through its loop, then caught by the handle.
      { ...DOWN, flip: -TAU, hang: 1 },
      { t: 0.3, y: -0.02, rx: 0.06, flip: -1.2, knifeEase: 'linear' },
      { t: 0.62, ...REST, hang: 0, ease: 'back', knifeEase: 'out' },
    ],
    idle: [
      { t: 0, ...REST },
      { t: 2.8, ...REST },
      { t: 3.4, rz: 0.04, flip: -0.1, ease: 'sine' },
      { t: 4.2, rz: 0, flip: 0, ease: 'sine' },
      { t: 6.6, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      { t: 0.45, x: -0.07, y: 0.07, z: 0.05, rx: -0.1, rz: 1.2, spin: PI / 2 },
      { t: 1.05, x: -0.074, y: 0.072, rz: 1.26, spin: PI / 2 + 0.1 },
      // Round the finger through its loop, twice, and caught.
      {
        t: 1.35,
        x: -0.04,
        y: 0.07,
        rx: -0.05,
        rz: 0.3,
        spin: 0,
        flip: -0.5,
        hang: 1,
        knifeEase: 'in',
      },
      { t: 1.95, flip: -TAU * 1.6, knifeEase: 'linear' },
      { t: 2.25, x: -0.03, y: 0.05, flip: -TAU * 2, knifeEase: 'out' },
      { t: 2.85, ...REST, flip: -TAU * 2 },
    ],
  },

  // The stiletto's blade swings out of its handle, with a click, on the draw and the inspect.
  stiletto: {
    draw: [
      { ...DOWN, a: PI },
      { t: 0.24, y: -0.04, rx: 0.1, a: PI, ease: 'out' },
      { t: 0.33, a: 0, rz: -0.08, knifeEase: 'out' },
      { t: 0.58, ...REST, ease: 'back' },
    ],
    idle: [
      { t: 0, ...REST },
      { t: 3, ...REST },
      { t: 3.6, rz: 0.04, spin: -0.1, ease: 'sine' },
      { t: 4.4, rz: 0, spin: 0, ease: 'sine' },
      { t: 6.8, ...REST },
    ],
    inspect: [
      { t: 0, ...REST },
      { t: 0.5, x: -0.07, y: 0.07, z: 0.05, rx: -0.1, rz: 1.2, spin: PI / 2 },
      { t: 1.1, x: -0.073, y: 0.072, rz: 1.25, spin: PI / 2 + 0.08 },
      // Folded away, then out again with a flick.
      { t: 1.45, x: -0.05, y: 0.05, rz: 0.7, a: PI, knifeEase: 'smooth' },
      { t: 1.7, a: PI },
      { t: 1.8, rz: 0.55, a: 0, knifeEase: 'out' },
      { t: 2.25, x: -0.07, y: 0.07, rz: 1.2, spin: (PI * 3) / 2 },
      { t: 2.7, x: -0.073, y: 0.072, rz: 1.25, spin: (PI * 3) / 2 + 0.08 },
      { t: 3.2, ...REST, spin: TAU },
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
  };
}

const compiled = new Map<KnifeSkin, KnifeMoves>(
  KNIFE_SKINS.map((skin) => [skin, compile(MOVES[skin])]),
);

/** How a knife moves in the hand. */
export function knifeMoves(skin: KnifeSkin): KnifeMoves {
  return compiled.get(skin)!;
}
