import { Color, MathUtils, Vector3 } from 'three';

/**
 * The kitchen keeps the visitor's own hours: the light outside the windows follows their local
 * clock, from night through dawn, morning, midday and the golden hour to evening service at the
 * blue hour, and back. A handful of hand-tuned looks are set at hours of the day, and any time in
 * between blends the two either side.
 */

/** Sky colors are given at these elevations, in degrees, from straight down to straight up. */
export const SKY_ELEVATIONS = [-90, -6, 0, 4, 11, 22, 40, 65, 90] as const;

export interface SkyLook {
  /** The sky at each of SKY_ELEVATIONS, on the side away from the sun... */
  readonly cool: readonly Color[];
  /** ...and on the side toward it (or where it has just set, or is about to rise). */
  readonly warm: readonly Color[];
  /** Unit direction to the sun; below the horizon at night. */
  readonly sun: Vector3;
  /** How far round the horizon the warm side reaches: higher is narrower. */
  readonly spread: number;
  /** How bright the stars are, 0 to 1. */
  readonly stars: number;
  /** How bright the moon is, 0 to 1. */
  readonly moon: number;
  /** Light on the land: from all around, from the sky above, and straight from the sun. */
  readonly ambient: number;
  readonly skylight: number;
  readonly sunlight: number;
  readonly sunTint: Color;
  /** Lamps outside (farm windows, the glasshouse, string lights): 0 by day, 1 by night. */
  readonly lamps: number;
  /** Inside: the light through the windows, and the sky's fill, as multiples of the evening's. */
  readonly windowColor: Color;
  readonly windowStrength: number;
  readonly fillColor: Color;
  readonly fillStrength: number;
  /** How thick the haze of distance is: thinner in clear daylight. */
  readonly haze: number;
}

/** A direction in the sky by azimuth (degrees east of north) and elevation (degrees). */
export function skyward(azimuth: number, elevation: number): Vector3 {
  const t = MathUtils.degToRad(azimuth);
  const e = MathUtils.degToRad(elevation);
  return new Vector3(Math.cos(e) * Math.sin(t), Math.sin(e), -Math.cos(e) * Math.cos(t));
}

const colors = (list: readonly string[]): Color[] => list.map((hex) => new Color(hex));

interface LookSpec {
  readonly cool: readonly string[];
  /** Overrides for the warm side, from the bottom; the rest match the cool side. */
  readonly warm?: readonly string[];
  readonly sun: readonly [number, number];
  readonly spread: number;
  readonly stars: number;
  readonly moon: number;
  readonly ambient: number;
  readonly skylight: number;
  readonly sunlight: number;
  readonly sunTint: string;
  readonly lamps: number;
  readonly window: readonly [string, number];
  readonly fill: readonly [string, number];
  readonly haze?: number;
}

function look(spec: LookSpec): SkyLook {
  const cool = colors(spec.cool);
  const warm = cool.map((c, i) => (spec.warm?.[i] ? new Color(spec.warm[i]) : c.clone()));
  return {
    cool,
    warm,
    sun: skyward(spec.sun[0], spec.sun[1]),
    spread: spec.spread,
    stars: spec.stars,
    moon: spec.moon,
    ambient: spec.ambient,
    skylight: spec.skylight,
    sunlight: spec.sunlight,
    sunTint: new Color(spec.sunTint),
    lamps: spec.lamps,
    windowColor: new Color(spec.window[0]),
    windowStrength: spec.window[1],
    fillColor: new Color(spec.fill[0]),
    fillStrength: spec.fill[1],
    haze: spec.haze ?? 1,
  };
}

const NIGHT = look({
  cool: [
    '#0d111b',
    '#151a28',
    '#2a3150',
    '#262d4a',
    '#1f2744',
    '#18213d',
    '#121a33',
    '#0e1529',
    '#0b1122',
  ],
  sun: [0, -25],
  spread: 3,
  stars: 1,
  moon: 1,
  ambient: 0.32,
  skylight: 0.3,
  sunlight: 0,
  sunTint: '#ffffff',
  lamps: 1,
  window: ['#3f5680', 0.55],
  fill: ['#3a4d70', 0.75],
});

const DAWN = look({
  cool: [
    '#1b1f2a',
    '#2e3242',
    '#a99bb0',
    '#9a93ae',
    '#7d84a6',
    '#5b6c98',
    '#41558a',
    '#2f4277',
    '#263866',
  ],
  warm: ['#1b1f2a', '#33313f', '#ffb07a', '#f4a583', '#d3a0a0', '#7f7fa3'],
  sun: [70, 2],
  spread: 2.5,
  stars: 0.25,
  moon: 0,
  ambient: 0.55,
  skylight: 0.45,
  sunlight: 1.4,
  sunTint: '#ffb48a',
  lamps: 0.6,
  window: ['#a7a9c9', 1.1],
  fill: ['#7c8fb5', 1.1],
});

const MORNING = look({
  cool: [
    '#2a3240',
    '#4a5566',
    '#dfe7ee',
    '#d0dfee',
    '#b5cdea',
    '#8db3e3',
    '#6a9ad9',
    '#4f84cf',
    '#4277c4',
  ],
  warm: ['#2a3240', '#4a5566', '#f7e2c4', '#ecdfcf', '#c6d4e6'],
  sun: [95, 22],
  spread: 2,
  stars: 0,
  moon: 0,
  ambient: 0.8,
  skylight: 0.55,
  sunlight: 1.1,
  sunTint: '#fff1d6',
  lamps: 0,
  window: ['#e8f0fb', 1.45],
  fill: ['#b9cbe4', 1.2],
  haze: 0.65,
});

const MIDDAY = look({
  cool: [
    '#2a3240',
    '#4a5566',
    '#e2ebf3',
    '#d3e3f2',
    '#b8d2ee',
    '#8fb8e8',
    '#6aa0e0',
    '#4e88d6',
    '#3f79cb',
  ],
  warm: ['#2a3240', '#4a5566', '#eef1f2', '#e0e9f2', '#c3d7ef'],
  sun: [180, 58],
  spread: 2,
  stars: 0,
  moon: 0,
  ambient: 0.9,
  skylight: 0.6,
  sunlight: 0.9,
  sunTint: '#fffaf0',
  lamps: 0,
  window: ['#f2f6fc', 1.6],
  fill: ['#c3d4ea', 1.3],
  haze: 0.6,
});

const AFTERNOON = look({
  cool: [
    '#2a3240',
    '#4a5566',
    '#dfe5ea',
    '#cfdcea',
    '#b3c9e6',
    '#8aaedf',
    '#6996d4',
    '#4f80ca',
    '#4274bf',
  ],
  warm: ['#2a3240', '#4a5566', '#f5dcbc', '#ead9c8', '#c9d2e2'],
  sun: [250, 24],
  spread: 2,
  stars: 0,
  moon: 0,
  ambient: 0.8,
  skylight: 0.55,
  sunlight: 1.15,
  sunTint: '#ffeccc',
  lamps: 0,
  window: ['#eef0f4', 1.45],
  fill: ['#b7c6dc', 1.2],
  haze: 0.65,
});

const GOLDEN = look({
  cool: [
    '#232838',
    '#3a3f52',
    '#c9b6b8',
    '#bba9b4',
    '#9aa0bd',
    '#7088b8',
    '#5571a8',
    '#405d96',
    '#354f85',
  ],
  warm: ['#232838', '#433d4c', '#ffb46a', '#ffa06e', '#f0a084', '#c99a9a'],
  sun: [-70, 3],
  spread: 2.2,
  stars: 0,
  moon: 0.2,
  ambient: 0.6,
  skylight: 0.45,
  sunlight: 1.8,
  sunTint: '#ffa45c',
  lamps: 0.4,
  window: ['#f3c9a0', 1.4],
  fill: ['#a39aa8', 1.15],
  haze: 0.85,
});

/** Evening service: the look the kitchen was lit for, after Ratatouille. */
const BLUE_HOUR = look({
  cool: [
    '#1a202c',
    '#2a3040',
    '#8e8aa8',
    '#8786a6',
    '#727599',
    '#4d5b86',
    '#32416a',
    '#1f2b4b',
    '#151f38',
  ],
  warm: ['#1a202c', '#2d3040', '#efa982', '#d99f8c', '#a4889a', '#57618d', '#34436b'],
  sun: [-33.5, 5.7],
  spread: 3,
  stars: 1,
  moon: 1,
  ambient: 0.5,
  skylight: 0.5,
  sunlight: 1.6,
  sunTint: '#ffb48a',
  lamps: 1,
  window: ['#7f9dc9', 1],
  fill: ['#5f7aa0', 1],
});

const LATE_EVENING = look({
  cool: [
    '#141925',
    '#202636',
    '#4a4d6e',
    '#43496b',
    '#363f62',
    '#28335a',
    '#1d2849',
    '#16203d',
    '#111a33',
  ],
  warm: ['#141925', '#232636', '#7a6276', '#5e5370', '#43456a'],
  sun: [-20, -8],
  spread: 3,
  stars: 1,
  moon: 1,
  ambient: 0.4,
  skylight: 0.4,
  sunlight: 0.6,
  sunTint: '#d08a78',
  lamps: 1,
  window: ['#5c7299', 0.75],
  fill: ['#4b6088', 0.85],
});

/** The looks through the day, by local hour. Night wraps round midnight. */
export const KEYFRAMES: readonly (readonly [number, SkyLook])[] = [
  [0, NIGHT],
  [4.8, NIGHT],
  [6, DAWN],
  [8, MORNING],
  [12.5, MIDDAY],
  [16.5, AFTERNOON],
  [18.6, GOLDEN],
  [19.8, BLUE_HOUR],
  [21.3, LATE_EVENING],
  [23, NIGHT],
];

const lerpColors = (a: readonly Color[], b: readonly Color[], t: number): Color[] =>
  a.map((c, i) => c.clone().lerp(b[i]!, t));

function blend(a: SkyLook, b: SkyLook, t: number): SkyLook {
  const n = (x: number, y: number) => x + (y - x) * t;
  return {
    cool: lerpColors(a.cool, b.cool, t),
    warm: lerpColors(a.warm, b.warm, t),
    sun: a.sun.clone().lerp(b.sun, t).normalize(),
    spread: n(a.spread, b.spread),
    stars: n(a.stars, b.stars),
    moon: n(a.moon, b.moon),
    ambient: n(a.ambient, b.ambient),
    skylight: n(a.skylight, b.skylight),
    sunlight: n(a.sunlight, b.sunlight),
    sunTint: a.sunTint.clone().lerp(b.sunTint, t),
    lamps: n(a.lamps, b.lamps),
    windowColor: a.windowColor.clone().lerp(b.windowColor, t),
    windowStrength: n(a.windowStrength, b.windowStrength),
    fillColor: a.fillColor.clone().lerp(b.fillColor, t),
    fillStrength: n(a.fillStrength, b.fillStrength),
    haze: n(a.haze, b.haze),
  };
}

/** The look at a local hour (0 to 24, fractional), blended from the keyframes either side. */
export function lookAt(hour: number): SkyLook {
  const h = ((hour % 24) + 24) % 24;
  for (let i = 0; i < KEYFRAMES.length; i++) {
    const [h0, a] = KEYFRAMES[i]!;
    const [h1, b] = KEYFRAMES[i + 1] ?? [24, KEYFRAMES[0]![1]];
    if (h >= h0 && h < h1) return blend(a, b, (h - h0) / (h1 - h0));
  }
  return KEYFRAMES[0]![1];
}

/** The hour `?time=13:30` (or `?time=21`) pins, for trying the look at another hour, if any. */
export function pinnedHour(search: string): number | null {
  const pinned = /^(\d{1,2})(?::(\d{2}))?$/.exec(new URLSearchParams(search).get('time') ?? '');
  if (!pinned) return null;
  const h = Number(pinned[1]);
  const m = Number(pinned[2] ?? 0);
  return h < 24 && m < 60 ? h + m / 60 : null;
}

/** The visitor's local hour, fractional, unless `?time=` pins it. */
export function visitorHour(now: Date, search: string): number {
  return pinnedHour(search) ?? now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
}
