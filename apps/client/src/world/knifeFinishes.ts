import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
} from 'three';
import { KNIFE_FINISHES, type KnifeFinish } from '@world/shared';

/**
 * Knife finishes, after the most loved paints on CS2's knives, and what the rest of a knife is made
 * of, painted by code into two shared textures: the color, and the surface (roughness in green and
 * metalness in blue, as three.js reads them). A strip per finish, then a strip per material.
 * Painting is deterministic, so every visitor sees the same knife, and each strip is painted only
 * once something wears it.
 *
 * In a finish's strip, u runs along the blade from the tip (0) to the base (1) and v across it from
 * the edge (0) to the spine (1). A material's strip is in meters instead (`materialUv`): along the
 * part from its end nearest the tip, and up from its lowest point.
 */

/** A texel of a finish or a material: its color (sRGB, 0 to 1), roughness and metalness. */
export interface Texel {
  readonly color: Rgb;
  roughness: number;
  metal: number;
}

export interface Finish {
  readonly name: string;
  /** A grip in this finish: Doppler's and Marble Fade's are black. Otherwise the knife's own. */
  readonly grip?: string;
  /** The finish at (u, v), written into `out`. */
  paint(u: number, v: number, out: Texel): void;
}

/**
 * What a part that does not wear the finish is made of. A handle's color is the knife's own (a
 * vertex color), which its material's pattern shades; `steel` is the bare brushed steel of
 * bolsters, pommels and pins.
 */
export type Material = 'wood' | 'micarta' | 'g10' | 'rubber' | 'cord' | 'steel';
const MATERIALS: readonly Material[] = ['wood', 'micarta', 'g10', 'rubber', 'cord', 'steel'];

type Rgb = [number, number, number];

/** Texels along a strip: about as many as a blade covers on a retina screen, in the hand. */
const WIDTH = 512;
const STRIP = 64;
/** Rows of a strip that a blade maps onto; the rest is margin, so mipmaps do not bleed. */
const MARGIN = 4;
const HEIGHT = STRIP * (KNIFE_FINISHES.length + MATERIALS.length);
/** A blade is about five times as long as it is tall; patterns are drawn to that scale. */
const ASPECT = 5;
/** How much of a part a material's strip covers, in meters: more than any handle. */
const MATERIAL_LENGTH = 0.16;
const MATERIAL_HEIGHT = 0.06;

// ---------- Noise ----------

/** A hash of two integers to 0..1, the same on every machine. */
function hash(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const smooth = (t: number): number => t * t * (3 - 2 * t);

function noise(x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const a = hash(xi, yi);
  const b = hash(xi + 1, yi);
  const c = hash(xi, yi + 1);
  const d = hash(xi + 1, yi + 1);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal noise, 0..1, a few octaves. */
function fbm(x: number, y: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise(x, y) * amp;
    norm += amp;
    x = x * 2.03 + 17.1;
    y = y * 2.03 + 9.7;
    amp *= 0.5;
  }
  return sum / norm;
}

const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
const smoothstep = (a: number, b: number, t: number): number => smooth(clamp01((t - a) / (b - a)));
const fract = (t: number): number => t - Math.floor(t);

function hex(color: string): Rgb {
  const n = Number.parseInt(color.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function mix(out: Rgb, a: Rgb, b: Rgb, t: number): Rgb {
  out[0] = a[0] + (b[0] - a[0]) * t;
  out[1] = a[1] + (b[1] - a[1]) * t;
  out[2] = a[2] + (b[2] - a[2]) * t;
  return out;
}

/** A color ramp: stops of [position, color], positions ascending. */
function ramp(stops: readonly (readonly [number, Rgb])[], t: number, out: Rgb): Rgb {
  if (t <= stops[0]![0]) return mix(out, stops[0]![1], stops[0]![1], 0);
  for (let i = 1; i < stops.length; i++) {
    const [p1, c1] = stops[i]!;
    if (t <= p1) {
      const [p0, c0] = stops[i - 1]!;
      return mix(out, c0, c1, smooth((t - p0) / (p1 - p0)));
    }
  }
  const last = stops[stops.length - 1]![1];
  return mix(out, last, last, 0);
}

function scale(out: Rgb, k: number): Rgb {
  out[0] = clamp01(out[0] * k);
  out[1] = clamp01(out[1] * k);
  out[2] = clamp01(out[2] * k);
  return out;
}

function grey(out: Rgb, k: number): Rgb {
  out[0] = out[1] = out[2] = clamp01(k);
  return out;
}

/** Steel brushed along its length: a streak per texel row, 0 to 1. */
function brushed(x: number, v: number): number {
  return noise(x * 0.8, v * 60) * 0.6 + noise(x * 0.2 + 4, v * 140) * 0.4;
}

// ---------- The finishes ----------

const STEEL = hex('#d5dbe0');
const SATIN = hex('#c3c9ce');
const DARK_STEEL = hex('#6d747b');
const LIGHT_STEEL = hex('#d3d9de');

const FADE: readonly (readonly [number, Rgb])[] = [
  [0, hex('#4b3cc4')],
  [0.28, hex('#b53ad0')],
  [0.52, hex('#ef5a9c')],
  [0.78, hex('#f6c64a')],
  [1, hex('#f3d65a')],
];
const DOPPLER: readonly (readonly [number, Rgb])[] = [
  [0, hex('#0c0712')],
  [0.24, hex('#36113d')],
  [0.44, hex('#981d5a')],
  [0.64, hex('#de3d7b')],
  [0.84, hex('#f48db5')],
  [1, hex('#ffdcea')],
];
const MARBLE: readonly Rgb[] = [hex('#d8242b'), hex('#f6c22f'), hex('#2d6fe0'), hex('#f6c22f')];
const TIGER = hex('#f0a21c');
const TIGER_STRIPE = hex('#7d3606');
const CRIMSON = hex('#86101a');
const WEB_LINE = hex('#0e0507');
const CASE_STEEL = hex('#8d9296');
const CASE_BLUE = hex('#2a5aa6');
const CASE_GOLD = hex('#c8a040');
const CASE_PURPLE = hex('#6b4b8f');
const SLAUGHTER = hex('#b2161f');
const SLAUGHTER_LIGHT = hex('#efcdc6');

const tmpA: Rgb = [0, 0, 0];
const tmpB: Rgb = [0, 0, 0];

/** Distance from (x, y) to the strands of a spider web centered at (cx, cy). */
function webDistance(x: number, y: number, cx: number, cy: number, seed: number): number {
  const dx = x - cx;
  const dy = y - cy;
  const r = Math.hypot(dx, dy);
  const spokes = 9;
  const angle = Math.atan2(dy, dx) + Math.PI;
  const sector = (angle / (Math.PI * 2)) * spokes;
  const k = Math.floor(sector);
  // Each spoke a little off its even angle.
  const spokeAngle = (i: number): number =>
    ((i + (hash(i % spokes, seed) - 0.5) * 0.35) / spokes) * Math.PI * 2 - Math.PI;
  const a0 = spokeAngle(k);
  const a1 = spokeAngle(k + 1);
  const toSpoke = Math.min(
    Math.abs(r * Math.sin(Math.atan2(dy, dx) - a0)),
    Math.abs(r * Math.sin(Math.atan2(dy, dx) - a1)),
  );
  // Rings sag between spokes, a little further apart outward.
  const f = fract(sector);
  const sag = 1 + 0.12 * Math.sin(f * Math.PI);
  const spacing = 0.28;
  const ring = (r * sag) / spacing;
  const toRing = Math.abs(fract(ring + 0.5) - 0.5) * spacing;
  return r < 0.04 ? 0 : Math.min(toSpoke, toRing);
}

/**
 * How metal a finish is. Bare steel reflects the room and takes a little of the lamps' light on
 * its body, so it reads as steel in the dim evening room too, where wholly metal it went black.
 * Color laid over polished steel (candy paint, anodizing) shows in any light, its gloss over it;
 * tempered colors are in the steel; prints sit on top of it.
 */
const BARE = 0.9;
const CANDY = 0.6;
const TEMPERED = 0.8;
const PRINT = 0.55;

/**
 * The finishes: glossy under candy paint (Doppler, Fade, Marble Fade), satin where the steel is
 * brushed, duller where it is etched or printed on.
 */
export const FINISHES: Readonly<Record<KnifeFinish, Finish>> = {
  stock: {
    name: 'Stock',
    paint(u, v, out) {
      mix(out.color, STEEL, STEEL, 0);
      // Satin, brushed along the blade.
      out.metal = BARE;
      out.roughness = 0.26 + 0.1 * brushed(u * ASPECT, v);
    },
  },
  damascus: {
    name: 'Damascus',
    paint(u, v, out) {
      const x = u * ASPECT;
      // Folded steel: flowing bands of light and dark, pulled about by the forging.
      const f = x * 4.2 + 0.8 * Math.sin(v * 6 + x * 1.3) + 1.8 * fbm(x * 1.1, v * 2.2, 4);
      // Thin darker folds over light steel, not stripes.
      const fold = 0.5 + 0.5 * Math.sin(f * Math.PI * 2);
      const dark = smoothstep(0.62, 0.95, fold) * 0.8;
      mix(out.color, LIGHT_STEEL, DARK_STEEL, dark);
      // The etch leaves the dark folds dull and the light ones polished.
      out.metal = BARE;
      out.roughness = 0.2 + 0.3 * dark;
    },
  },
  doppler: {
    name: 'Doppler',
    grip: '#17161b',
    paint(u, v, out) {
      const x = u * ASPECT;
      // Candy paint over a mirror: dark swirls through pink and violet.
      const w = fbm(x * 0.55 + 3, v * 1.2, 3);
      const n = fbm(x * 0.7 + w * 2.2, v * 1.6 + w * 1.4, 5);
      ramp(DOPPLER, clamp01((n - 0.22) * 2.1), out.color);
      out.metal = CANDY;
      out.roughness = 0.12 + 0.05 * n;
    },
  },
  fade: {
    name: 'Fade',
    paint(u, v, out) {
      // Gold at the base through pink to violet at the tip, the line of it a little aslant.
      const t = clamp01(u * 1.12 - (v - 0.5) * 0.32 + (fbm(u * 6, v * 2, 2) - 0.5) * 0.06);
      ramp(FADE, t, out.color);
      out.metal = CANDY;
      out.roughness = 0.15;
    },
  },
  marble: {
    name: 'Marble Fade',
    grip: '#17161b',
    paint(u, v, out) {
      const x = u * ASPECT;
      // Fire and ice: red, yellow and blue, flowing in marbled bands.
      const f = x * 0.3 + 0.45 * Math.sin(v * 3 + x * 0.7) + 1.5 * fbm(x * 0.45, v * 0.9, 4);
      const t = fract(f) * MARBLE.length;
      const i = Math.floor(t);
      mix(
        out.color,
        MARBLE[i % MARBLE.length]!,
        MARBLE[(i + 1) % MARBLE.length]!,
        smoothstep(0.3, 1, t - i),
      );
      out.metal = CANDY;
      out.roughness = 0.14;
    },
  },
  tiger: {
    name: 'Tiger Tooth',
    paint(u, v, out) {
      const x = u * ASPECT;
      // Gold, with dark stripes rippling across the blade.
      const f = x * 2.1 + v * 0.7 + 0.22 * Math.sin(v * 7 + x * 2.3) + 0.5 * fbm(x * 1.3, v * 2, 3);
      const p = fract(f);
      const stripe = smoothstep(0.52, 0.6, p) * (1 - smoothstep(0.82, 0.9, p));
      mix(out.color, TIGER, TIGER_STRIPE, stripe);
      scale(out.color, 0.92 + 0.16 * fbm(x * 3, v * 5, 2));
      // Anodized: polished gold, the stripes a little duller.
      out.metal = CANDY;
      out.roughness = 0.17 + 0.1 * stripe;
    },
  },
  web: {
    name: 'Crimson Web',
    grip: '#3f0d12',
    paint(u, v, out) {
      const x = u * ASPECT;
      // Deep red with black web strands from two centers.
      const d = Math.min(webDistance(x, v, 2.9, 0.55, 3), webDistance(x, v, 0.6, 0.3, 7));
      const line = 1 - smoothstep(0.012, 0.03, d);
      mix(tmpA, CRIMSON, CRIMSON, 0);
      scale(tmpA, 0.85 + 0.3 * fbm(x * 1.5, v * 2.5, 3));
      mix(out.color, tmpA, WEB_LINE, line * 0.92);
      // A satin red over the steel, its black strands printed on, matte.
      out.metal = PRINT * (1 - 0.6 * line);
      out.roughness = 0.3 + 0.28 * line;
    },
  },
  case: {
    name: 'Case Hardened',
    paint(u, v, out) {
      const x = u * ASPECT;
      // Heat-tempered patches: blue and gold over grey steel, a touch of violet between.
      const blue = smoothstep(0.5, 0.62, fbm(x * 0.9, v * 1.8, 4));
      const gold = smoothstep(0.54, 0.66, fbm(x * 1.1 + 11, v * 2.1 + 5, 4));
      const purple = smoothstep(0.6, 0.7, fbm(x * 1.6 + 23, v * 2.6 + 9, 3));
      const mottle = fbm(x * 4, v * 6, 2);
      mix(out.color, CASE_STEEL, CASE_BLUE, blue);
      mix(out.color, out.color, CASE_GOLD, gold * (1 - blue * 0.6));
      mix(out.color, out.color, CASE_PURPLE, purple * 0.7);
      scale(out.color, 0.9 + 0.2 * mottle);
      // Tempered steel keeps its polish under the colors, mottled where the heat bloomed.
      out.metal = TEMPERED;
      out.roughness = 0.22 + 0.14 * mottle;
    },
  },
  slaughter: {
    name: 'Slaughter',
    paint(u, v, out) {
      const x = u * ASPECT;
      // Red with pale, pinkish patches like a butcher's marble.
      const n = fbm(x * 1.4 + 5, v * 2.4, 4);
      const patch = smoothstep(0.55, 0.62, n);
      mix(tmpB, SLAUGHTER, SLAUGHTER, 0);
      scale(tmpB, 0.82 + 0.3 * fbm(x * 2.2, v * 3.4, 3));
      mix(out.color, tmpB, SLAUGHTER_LIGHT, patch * 0.9);
      out.metal = PRINT;
      out.roughness = 0.2 + 0.12 * patch;
    },
  },
  vanilla: {
    name: 'Vanilla',
    paint(u, v, out) {
      const x = u * ASPECT;
      // Satin steel, brushed along its length.
      const streak = brushed(x, v);
      mix(out.color, SATIN, SATIN, 0);
      scale(out.color, 0.93 + streak * 0.12);
      out.metal = BARE;
      out.roughness = 0.28 + 0.1 * streak;
    },
  },
};

// ---------- The materials ----------

/**
 * What the rest of a knife is made of, painted at its real size (x along the part and y up it, in
 * millimetres) as a shade of the part's own color, about 1, and its roughness. Detail across a
 * handle is no finer than about 3 mm, the most its strip can hold.
 */
const MATERIAL_PAINT: Readonly<Record<Material, (x: number, y: number, out: Texel) => void>> = {
  wood: (x, y, out) => {
    // Straight grain along the handle, wandering a little: darker late wood, and open pores.
    const g = y / 3.2 + 1.3 * fbm(x * 0.012, y * 0.07, 3) + 0.12 * Math.sin(x * 0.045);
    const late = smoothstep(0.45, 0.95, 0.5 + 0.5 * Math.sin(g * Math.PI * 2));
    const pores = smoothstep(0.62, 0.85, noise(x * 0.9, y * 0.35));
    grey(out.color, 1 - 0.2 * late - 0.08 * pores - 0.06 * fbm(x * 0.05, y * 0.2, 2));
    // Oiled: a soft sheen, the pores dull.
    out.roughness = 0.46 + 0.1 * late + 0.12 * pores;
    out.metal = 0;
  },
  micarta: (x, y, out) => {
    // Linen layers pressed in resin: a soft mottle of fibres.
    const m = fbm(x * 0.35, y * 0.3, 4);
    const fibre = noise(x * 1.6, y * 0.5);
    grey(out.color, 0.86 + 0.12 * m + 0.04 * fibre);
    out.roughness = 0.5 + 0.12 * (1 - m);
    out.metal = 0;
  },
  g10: (x, y, out) => {
    // Glass fibre cut into a grip: a fine diamond texture over faint layers.
    const p = Math.abs(fract(x / 3 + y / 6) - 0.5) + Math.abs(fract(x / 3 - y / 6) - 0.5);
    const layer = 0.5 + 0.5 * Math.sin(y * 0.9 + 2 * fbm(x * 0.03, y * 0.1, 2));
    grey(out.color, 0.9 + 0.08 * p + 0.04 * layer);
    out.roughness = 0.52 + 0.18 * p;
    out.metal = 0;
  },
  rubber: (x, y, out) => {
    // Moulded rubber: matte, a fine stipple in its sheen.
    const stipple = noise(x * 1.3, y * 0.45);
    grey(out.color, 0.95 + 0.05 * fbm(x * 0.1, y * 0.1, 2));
    out.roughness = 0.76 + 0.14 * stipple;
    out.metal = 0;
  },
  cord: (x, y, out) => {
    // A paracord sheath, wound across the handle: its strands in a herringbone along the cord.
    const s = fract(y / 3.2 + Math.abs(fract(x / 2.4) - 0.5) * 1.2);
    const strand = smoothstep(0.1, 0.5, s) * (1 - smoothstep(0.6, 0.95, s));
    grey(out.color, 0.7 + 0.3 * strand);
    out.roughness = 0.82 + 0.12 * (1 - strand);
    out.metal = 0;
  },
  steel: (x, y, out) => {
    // Bare steel, brushed along the part.
    const streak = noise(x * 0.06, y * 3) * 0.6 + noise(x * 0.02 + 4, y * 7) * 0.4;
    grey(out.color, 0.95 + 0.05 * streak);
    out.roughness = 0.26 + 0.1 * streak;
    out.metal = BARE;
  },
};

// ---------- The textures ----------

let colors: DataTexture | null = null;
let surfaces: DataTexture | null = null;
const painted = new Set<KnifeFinish | Material>();

function texture(colorSpace: string): DataTexture {
  const data = new Uint8Array(WIDTH * HEIGHT * 4).fill(255);
  const t = new DataTexture(data, WIDTH, HEIGHT, RGBAFormat, UnsignedByteType);
  t.colorSpace = colorSpace;
  t.wrapS = ClampToEdgeWrapping;
  t.wrapT = ClampToEdgeWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

/** The colors every knife shares. Starts white; strips are painted as needed. */
export function finishTexture(): DataTexture {
  return (colors ??= texture(SRGBColorSpace));
}

/** Roughness (green) and metalness (blue) for every knife, laid out as the colors are. */
export function surfaceTexture(): DataTexture {
  return (surfaces ??= texture(NoColorSpace));
}

const texel: Texel = { color: [0, 0, 0], roughness: 0, metal: 0 };

/** Paint strip `strip`, (u, v) across it from 0 to 1. */
function paintStrip(strip: number, paint: (u: number, v: number, out: Texel) => void): void {
  const color = finishTexture().image.data as Uint8Array;
  const surface = surfaceTexture().image.data as Uint8Array;
  for (let row = 0; row < STRIP; row++) {
    // The margin rows repeat the pattern's own edge, so filtering never reaches another strip.
    const v = clamp01((row + 0.5 - MARGIN) / (STRIP - MARGIN * 2));
    for (let col = 0; col < WIDTH; col++) {
      paint(col / (WIDTH - 1), v, texel);
      const i = ((strip * STRIP + row) * WIDTH + col) * 4;
      color[i] = Math.round(texel.color[0] * 255);
      color[i + 1] = Math.round(texel.color[1] * 255);
      color[i + 2] = Math.round(texel.color[2] * 255);
      surface[i + 1] = Math.round(clamp01(texel.roughness) * 255);
      surface[i + 2] = Math.round(clamp01(texel.metal) * 255);
    }
  }
  finishTexture().needsUpdate = true;
  surfaceTexture().needsUpdate = true;
}

/** Paint a finish's strip, if it has not been yet. */
export function paintFinish(finish: KnifeFinish): void {
  if (painted.has(finish)) return;
  painted.add(finish);
  const style = FINISHES[finish];
  paintStrip(KNIFE_FINISHES.indexOf(finish), (u, v, out) => style.paint(u, v, out));
}

/** Paint a material's strip, if it has not been yet. */
export function paintMaterial(material: Material): void {
  if (painted.has(material)) return;
  painted.add(material);
  const paint = MATERIAL_PAINT[material];
  paintStrip(KNIFE_FINISHES.length + MATERIALS.indexOf(material), (u, v, out) =>
    paint(u * MATERIAL_LENGTH * 1000, v * MATERIAL_HEIGHT * 1000, out),
  );
}

/** Where (u, v) of strip `strip` lands in the shared textures. */
function stripUv(strip: number, u: number, v: number, out: [number, number]): void {
  out[0] = (0.5 + clamp01(u) * (WIDTH - 1)) / WIDTH;
  out[1] = (strip * STRIP + MARGIN + clamp01(v) * (STRIP - MARGIN * 2)) / HEIGHT;
}

/** Where (u, v) of a finish lands in the shared textures. */
export function finishUv(finish: KnifeFinish, u: number, v: number, out: [number, number]): void {
  stripUv(KNIFE_FINISHES.indexOf(finish), u, v, out);
}

/** Where a point of a part made of `material` lands: `along` and `up` it, in meters. */
export function materialUv(
  material: Material,
  along: number,
  up: number,
  out: [number, number],
): void {
  const strip = KNIFE_FINISHES.length + MATERIALS.indexOf(material);
  stripUv(strip, along / MATERIAL_LENGTH, up / MATERIAL_HEIGHT, out);
}

/** The raw pixels of the textures, for a second renderer to wrap without painting again. */
export function finishPixels(): {
  color: Uint8Array;
  surface: Uint8Array;
  width: number;
  height: number;
} {
  return {
    color: finishTexture().image.data as Uint8Array,
    surface: surfaceTexture().image.data as Uint8Array,
    width: WIDTH,
    height: HEIGHT,
  };
}

/** A finish's pattern as painted along a blade (tip first), for a swatch: RGBA rows, edge to spine. */
export function finishSwatch(finish: KnifeFinish): {
  data: Uint8ClampedArray;
  width: number;
  height: number;
} {
  paintFinish(finish);
  const data = finishTexture().image.data as Uint8Array;
  const rows = STRIP - MARGIN * 2;
  const start = (KNIFE_FINISHES.indexOf(finish) * STRIP + MARGIN) * WIDTH * 4;
  return {
    data: new Uint8ClampedArray(data.subarray(start, start + rows * WIDTH * 4)),
    width: WIDTH,
    height: rows,
  };
}
