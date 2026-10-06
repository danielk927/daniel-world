import {
  BoxGeometry,
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  MathUtils,
  Vector3,
  type Matrix4,
} from 'three';
import { ROOM_HALF_Z, createRandom } from '@world/shared';
import { at } from './builder.ts';
import type { Kit } from './kit.ts';

/**
 * The view through the north windows at the blue hour: the kitchen garden across a country lane,
 * vines on the slope behind it, a farmhouse and a village with their lamps lit, wooded hills, a
 * ring of mountains, and the sky with the last of the afterglow, a few stars and a new moon.
 *
 * It is all real geometry, so each layer slides past the next as a visitor walks along the
 * windows, and it closes in every direction a window can see: the land runs to the mountains on
 * either side, the mountains stand against a whole dome of sky. It is unlit, like a matte
 * painting: the dusk light and the haze of distance are baked into the vertex colors once, so the
 * whole view is one draw call and costs nothing per frame. The string lights are the only part
 * on the kitchen's own `light` layer, so the bloom catches them.
 */

/** The outside face of the north wall; the land starts here. */
const WALL_Z = -ROOM_HALF_Z - 0.25;
/** The ground outside sits a little below the kitchen floor. */
const GROUND = -0.3;
/** Where the haze and the sky's directions are measured from: a cook at the windows. */
const EYE = new Vector3(0, 1.6, WALL_Z);
/** The sky dome, centered on the windows like the land, inside the camera's far plane from anywhere in the room. */
export const SKY_RADIUS = 178;
export const SKY_CENTER = new Vector3(0, 0, WALL_Z);
/** The land, out to the far side of the mountains. */
const LAND_RADIUS = 166;

/** The sun has just set, a little west of north: the afterglow sits low on that horizon. */
const AFTERGLOW = new Vector3(-0.55, 0.1, -0.83).normalize();
const AFTERGLOW_TINT = new Color('#ffb48a');

/** The sky by elevation (degrees): cool on most of the horizon, warm toward the afterglow. */
const SKY_STOPS: readonly (readonly [number, Color, Color])[] = (
  [
    [-90, '#1a202c', '#1a202c'],
    [-6, '#2a3040', '#2d3040'],
    [0, '#8e8aa8', '#efa982'],
    [4, '#8786a6', '#d99f8c'],
    [11, '#727599', '#a4889a'],
    [22, '#4d5b86', '#57618d'],
    [40, '#32416a', '#34436b'],
    [65, '#1f2b4b', '#1f2b4b'],
    [90, '#151f38', '#151f38'],
  ] as const
).map(([e, cool, warm]) => [e, new Color(cool), new Color(warm)] as const);

const scratchCool = new Color();
const scratchWarm = new Color();

/** The color of the sky in a direction (any length). */
export function skyColor(direction: Vector3, target = new Color()): Color {
  const length = direction.length();
  const elevation = MathUtils.radToDeg(Math.asin(MathUtils.clamp(direction.y / length, -1, 1)));
  const flat = Math.hypot(direction.x, direction.z) || 1;
  const toward = (direction.x * AFTERGLOW.x + direction.z * AFTERGLOW.z) / flat;
  const glowFlat = Math.hypot(AFTERGLOW.x, AFTERGLOW.z);
  const warmth = Math.max(0, toward / glowFlat) ** 3;
  let i = 1;
  while (i < SKY_STOPS.length - 1 && SKY_STOPS[i]![0] < elevation) i++;
  const [e0, cool0, warm0] = SKY_STOPS[i - 1]!;
  const [e1, cool1, warm1] = SKY_STOPS[i]!;
  const t = MathUtils.clamp((elevation - e0) / (e1 - e0), 0, 1);
  scratchCool.lerpColors(cool0, cool1, t);
  scratchWarm.lerpColors(warm0, warm1, t);
  return target.lerpColors(scratchCool, scratchWarm, warmth);
}

/** Smooth value noise in 0..1, seeded, for the lay of the land. */
function valueNoise(seed: number): (x: number, z: number) => number {
  const random = createRandom(seed);
  const table = Float32Array.from({ length: 1024 }, () => random());
  const corner = (i: number, j: number): number =>
    table[(Math.imul(i, 73856093) ^ Math.imul(j, 19349663)) & 1023]!;
  return (x, z) => {
    const i = Math.floor(x);
    const j = Math.floor(z);
    const u = x - i;
    const v = z - j;
    const fu = u * u * (3 - 2 * u);
    const fv = v * v * (3 - 2 * v);
    const top = MathUtils.lerp(corner(i, j), corner(i + 1, j), fu);
    const bottom = MathUtils.lerp(corner(i, j + 1), corner(i + 1, j + 1), fu);
    return MathUtils.lerp(top, bottom, fv);
  };
}

const noise = valueNoise(907);
const fbm = (x: number, z: number): number =>
  (noise(x, z) * 4 + noise(x * 2.1, z * 2.1) * 2 + noise(x * 4.3, z * 4.3)) / 7;
const ridged = (x: number, z: number): number => {
  const ridge = (n: number) => 1 - Math.abs(n * 2 - 1);
  return (ridge(noise(x, z)) * 3 + ridge(noise(x * 2.3, z * 2.3)) * 1.4) / 4.4;
};

/** Distance from the middle of the windows, along the ground. */
const reach = (x: number, z: number): number => Math.hypot(x, z - WALL_Z);

/**
 * The height of the land: flat by the kitchen (the lane and the garden), rolling hills behind,
 * and a ring of mountains at the edge, tall enough that nothing past them shows.
 */
export function landHeight(x: number, z: number): number {
  const r = reach(x, z);
  const hills = MathUtils.smoothstep(r, 36, 85) * (1.5 + 11 * fbm(x / 38, z / 38));
  // The mountains come back down before the land ends, so the skyline is a ridge, not a cut edge.
  const range = MathUtils.smoothstep(r, 92, 145) * (1 - MathUtils.smoothstep(r, 150, LAND_RADIUS));
  const mountains = range * (14 + 44 * ridged(x / 52, z / 52));
  return GROUND + hills + mountains;
}

const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
const edge1 = new Vector3();
const edge2 = new Vector3();
const normal = new Vector3();
const centroid = new Vector3();
const toward = new Vector3();
const shaded = new Color();
const haze = new Color();

/**
 * Collects the view as one triangle soup with a color per corner. Faces are lit by the dusk once,
 * here: a cool sky from above, a warm rim from the afterglow, and the haze of distance, which
 * fades far things into the sky behind them so the hills stand in layers.
 */
class Painter {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];

  /** A triangle with its own corner colors, turned to face `facing` if given. */
  triangle(
    p0: Vector3,
    p1: Vector3,
    p2: Vector3,
    c0: Color,
    c1: Color,
    c2: Color,
    facing?: Vector3,
  ): void {
    let flip = false;
    if (facing) {
      edge1.subVectors(p1, p0);
      edge2.subVectors(p2, p0);
      flip = normal.crossVectors(edge1, edge2).dot(facing) < 0;
    }
    const corners = flip ? [p0, p2, p1] : [p0, p1, p2];
    const colors = flip ? [c0, c2, c1] : [c0, c1, c2];
    for (let i = 0; i < 3; i++) {
      this.positions.push(corners[i]!.x, corners[i]!.y, corners[i]!.z);
      this.colors.push(colors[i]!.r, colors[i]!.g, colors[i]!.b);
    }
  }

  /** A flat face of `base`, in the dusk light and the haze. */
  face(p0: Vector3, p1: Vector3, p2: Vector3, base: Color, facing?: Vector3): void {
    edge1.subVectors(p1, p0);
    edge2.subVectors(p2, p0);
    normal.crossVectors(edge1, edge2).normalize();
    if (facing && normal.dot(facing) < 0) normal.negate();
    centroid.copy(p0).add(p1).add(p2).divideScalar(3);
    const sky = 0.5 + 0.5 * Math.max(0, normal.y);
    const glow = Math.max(0, normal.dot(AFTERGLOW));
    shaded.copy(base).multiplyScalar(sky);
    shaded.r += AFTERGLOW_TINT.r * base.r * 1.6 * glow;
    shaded.g += AFTERGLOW_TINT.g * base.g * 1.6 * glow;
    shaded.b += AFTERGLOW_TINT.b * base.b * 1.6 * glow;
    hazed(shaded, centroid, 1);
    this.triangle(p0, p1, p2, shaded, shaded, shaded, facing);
  }

  /** A flat quad (corners in order around it), in the dusk light. */
  quad(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, base: Color, facing?: Vector3): void {
    this.face(p0, p1, p2, base, facing);
    this.face(p0, p2, p3, base, facing);
  }

  /** A lit window or a lamp: its own color, only lightly veiled by the haze. */
  glow(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, color: Color, facing: Vector3): void {
    centroid.copy(p0).add(p2).multiplyScalar(0.5);
    shaded.copy(color);
    hazed(shaded, centroid, 0.35);
    this.triangle(p0, p1, p2, shaded, shaded, shaded, facing);
    this.triangle(p0, p2, p3, shaded, shaded, shaded, facing);
  }

  /** Every face of a three.js geometry, placed by `matrix`, in the dusk light. */
  solid(geometry: BufferGeometry, matrix: Matrix4, base: Color): void {
    const position = geometry.getAttribute('position');
    const index = geometry.index;
    const count = index ? index.count : position.count;
    const corner = (i: number, target: Vector3): Vector3 =>
      target.fromBufferAttribute(position, index ? index.getX(i) : i).applyMatrix4(matrix);
    for (let i = 0; i < count; i += 3) {
      this.face(corner(i, a), corner(i + 1, b), corner(i + 2, c), base);
    }
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    geometry.computeVertexNormals();
    return geometry;
  }
}

/** Fade a color at `point` into the sky behind it, the further away the more. */
function hazed(color: Color, point: Vector3, strength: number): Color {
  toward.subVectors(point, EYE);
  const distance = toward.length();
  // The haze is the color of the sky low behind the point, not the sky straight above it.
  toward.y *= 0.4;
  skyColor(toward, haze);
  // Blended as paint, in sRGB: in linear light a little of the bright horizon swamps the darks.
  const t = (1 - Math.exp(-distance / 160)) * 0.8 * strength;
  return color.convertLinearToSRGB().lerp(haze.convertLinearToSRGB(), t).convertSRGBToLinear();
}

/** Palette, picked out of the dusk. */
const hex = (value: string): Color => new Color(value);
const PALETTE = {
  lawn: hex('#3a5a40'),
  fields: ['#3d5f40', '#365538', '#46653f', '#7c7046', '#4b5d3a', '#58654a'].map(hex),
  rock: hex('#56607a'),
  scree: hex('#68708a'),
  gravel: hex('#6f6b64'),
  road: hex('#44464f'),
  verge: hex('#2f4a35'),
  hedge: ['#28412f', '#2c4733', '#243b2b'].map(hex),
  wood: hex('#5e4532'),
  post: hex('#2a2522'),
  soil: hex('#33281f'),
  crops: ['#456b4c', '#5b7c4a', '#3e6152', '#6b8150'].map(hex),
  vine: ['#2e4a33', '#33503a', '#2a432f'].map(hex),
  leaves: ['#2d4a34', '#34553a', '#27412f', '#3b5a38'].map(hex),
  pine: ['#23392f', '#203429', '#2a4234'].map(hex),
  bark: hex('#3a2c22'),
  plaster: hex('#968874'),
  stone: hex('#77716a'),
  roof: hex('#7a4636'),
  slate: hex('#4d5260'),
  terracotta: hex('#9a5b3c'),
  lamplight: hex('#ffc26e'),
  glasshouse: hex('#d9a35e'),
  star: hex('#e8edff'),
  moon: hex('#f6edd2'),
} as const;

const unitBox = new BoxGeometry(1, 1, 1);
const crown = new IcosahedronGeometry(1, 0);
const fineCrown = new IcosahedronGeometry(1, 1);
const unitCone = new ConeGeometry(1, 1, 6);
unitCone.translate(0, 0.5, 0);
const trunk = new CylinderGeometry(0.7, 1, 1, 5);
trunk.translate(0, 0.5, 0);

/** A point on the ground. */
const ground = (x: number, z: number, lift = 0): Vector3 =>
  new Vector3(x, landHeight(x, z) + lift, z);

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.floor(random() * list.length)]!;
}

/** A whole dome of sky around the land, smooth from the zenith to below the horizon. */
function paintSky(painter: Painter): void {
  // Rows bunch up near the horizon, where the colors change fastest.
  const rows = [-40, -6, 0, 2, 4.5, 7.5, 11, 16, 22, 30, 40, 52, 65, 78, 90];
  const columns = 72;
  const point = (row: number, column: number): Vector3 => {
    const e = MathUtils.degToRad(rows[row]!);
    const t = (column / columns) * Math.PI * 2;
    return new Vector3(Math.cos(e) * Math.sin(t), Math.sin(e), -Math.cos(e) * Math.cos(t));
  };
  const inward = new Vector3();
  for (let row = 0; row < rows.length - 1; row++) {
    for (let column = 0; column < columns; column++) {
      const directions = [
        point(row, column),
        point(row, column + 1),
        point(row + 1, column + 1),
        point(row + 1, column),
      ];
      const [c0, c1, c2, c3] = directions.map((d) => skyColor(d));
      const [p0, p1, p2, p3] = directions.map((d) => aloft(d, SKY_RADIUS));
      inward.copy(directions[0]!).add(directions[2]!).negate();
      painter.triangle(p0!, p1!, p2!, c0!, c1!, c2!, inward);
      if (row < rows.length - 2) painter.triangle(p0!, p2!, p3!, c0!, c2!, c3!, inward);
    }
  }
}

/** The point `distance` out along `direction` from the middle of the sky. */
function aloft(direction: Vector3, distance: number): Vector3 {
  return direction.clone().multiplyScalar(distance).add(SKY_CENTER);
}

/** A direction in the sky by azimuth (degrees east of north) and elevation (degrees). */
function skyward(azimuth: number, elevation: number): Vector3 {
  const t = MathUtils.degToRad(azimuth);
  const e = MathUtils.degToRad(elevation);
  return new Vector3(Math.cos(e) * Math.sin(t), Math.sin(e), -Math.cos(e) * Math.cos(t));
}

/** An orthonormal frame across the sky at `direction`: right, and up. */
function skyFrame(direction: Vector3): [Vector3, Vector3] {
  const right = new Vector3(0, 1, 0).cross(direction).normalize();
  const up = new Vector3().crossVectors(direction, right).normalize();
  return [right, up];
}

const MOON = skyward(-40, 24);

/** A thin new moon low in the west, lit from below by the sun that just set, and early stars. */
function paintNight(painter: Painter): void {
  const random = createRandom(311);
  const inward = new Vector3();

  // The moon's halo: a fan, brighter in the middle, that fades out into the sky.
  const [right, up] = skyFrame(MOON);
  const center = aloft(MOON, SKY_RADIUS - 3);
  const middle = skyColor(MOON).add(new Color(0.05, 0.045, 0.04));
  const sides = 28;
  const haloRadius = 11;
  inward.copy(MOON).negate();
  for (let i = 0; i < sides; i++) {
    const rim = (k: number): Vector3 => {
      const angle = (k / sides) * Math.PI * 2;
      return center
        .clone()
        .addScaledVector(right, Math.cos(angle) * haloRadius)
        .addScaledVector(up, Math.sin(angle) * haloRadius);
    };
    const r0 = rim(i);
    const r1 = rim(i + 1);
    const color = (p: Vector3) => skyColor(p.clone().sub(SKY_CENTER));
    painter.triangle(center, r0, r1, middle, color(r0), color(r1), inward);
  }

  // The crescent: between the lit limb (a half circle) and the terminator (a half ellipse),
  // turned so the limb faces down and toward the afterglow.
  const radius = 2.4;
  const angle = MathUtils.degToRad(-75);
  const lit = right.clone().multiplyScalar(Math.cos(angle)).addScaledVector(up, Math.sin(angle));
  const along = new Vector3().crossVectors(MOON, lit).normalize();
  const moonCenter = aloft(MOON, SKY_RADIUS - 5);
  const steps = 18;
  const limb = (t: number, width: number): Vector3 =>
    moonCenter
      .clone()
      .addScaledVector(lit, Math.cos(t) * radius * width)
      .addScaledVector(along, Math.sin(t) * radius);
  for (let i = 0; i < steps; i++) {
    const t0 = -Math.PI / 2 + (i / steps) * Math.PI;
    const t1 = -Math.PI / 2 + ((i + 1) / steps) * Math.PI;
    const o0 = limb(t0, 1);
    const o1 = limb(t1, 1);
    const i0 = limb(t0, 0.45);
    const i1 = limb(t1, 0.45);
    painter.triangle(i0, o0, o1, PALETTE.moon, PALETTE.moon, PALETTE.moon, inward);
    painter.triangle(i0, o1, i1, PALETTE.moon, PALETTE.moon, PALETTE.moon, inward);
  }

  // Stars come out where the sky is darkest, high up and away from the afterglow and the moon.
  const color = new Color();
  for (let placed = 0; placed < 260;) {
    const azimuth = random() * 360;
    const elevation = MathUtils.radToDeg(Math.asin(random()));
    if (elevation < 14) continue;
    const direction = skyward(azimuth, elevation);
    if (direction.angleTo(MOON) < 0.12) continue;
    placed++;
    const sky = skyColor(direction);
    const brightness = 0.25 + random() ** 2 * 0.75;
    const fade = MathUtils.smoothstep(elevation, 14, 34);
    color.lerpColors(sky, PALETTE.star, brightness * fade);
    const size = 0.22 + random() * 0.18 + (random() < 0.08 ? 0.2 : 0);
    const [r, u] = skyFrame(direction);
    const p = aloft(direction, SKY_RADIUS - 6);
    const corner = (x: number, y: number): Vector3 =>
      p
        .clone()
        .addScaledVector(r, x * size)
        .addScaledVector(u, y * size);
    inward.copy(direction).negate();
    // A little diamond, which stays a point at any angle.
    const [n, e, s, w] = [corner(0, 1), corner(1, 0), corner(0, -1), corner(-1, 0)];
    painter.triangle(n, e, s, color, color, color, inward);
    painter.triangle(n, s, w, color, color, color, inward);
  }
}

/**
 * The land: a fan of faceted ground around the windows, half a circle wide, so that even a glance
 * along the wall lands on it. Near the kitchen it is lawn; further out a patchwork of fields over
 * the hills, then bare rock on the mountains.
 */
function paintLand(painter: Painter): void {
  const random = createRandom(73);
  const rings = [
    0,
    2,
    4,
    6.5,
    9,
    12,
    15,
    19,
    24,
    30,
    36,
    43,
    51,
    60,
    70,
    81,
    93,
    106,
    119,
    132,
    144,
    155,
    LAND_RADIUS,
  ];
  const sectors = 96;
  const point = (ring: number, sector: number): Vector3 => {
    const r = rings[ring]!;
    const t = -Math.PI / 2 + (sector / sectors) * Math.PI;
    const x = Math.sin(t) * r;
    const z = WALL_Z - Math.cos(t) * r;
    return new Vector3(x, landHeight(x, z), z);
  };
  const up = new Vector3(0, 1, 0);
  for (let ring = 0; ring < rings.length - 1; ring++) {
    for (let sector = 0; sector < sectors; sector++) {
      const p0 = point(ring, sector);
      const p1 = point(ring, sector + 1);
      const p2 = point(ring + 1, sector + 1);
      const p3 = point(ring + 1, sector);
      const r = rings[ring]!;
      const height = (p0.y + p1.y + p2.y + p3.y) / 4 - GROUND;
      let base: Color;
      if (r < 34) base = PALETTE.lawn;
      else if (height > 30) base = PALETTE.scree;
      else if (height > 14) base = PALETTE.rock;
      else base = pick(PALETTE.fields, random);
      painter.quad(p0, p1, p2, p3, base, up);
    }
  }
}

/** The lane along the front of the garden; past the garden it bends away into the hills. */
const laneZ = (x: number): number => -12 - Math.max(0, Math.abs(x) - 34) ** 2 * 0.004;

function paintLane(painter: Painter): void {
  const up = new Vector3(0, 1, 0);
  const half = 1.9;
  // A gravel apron under the windows, between the kitchen and the lane.
  painter.quad(
    new Vector3(-10, GROUND + 0.04, WALL_Z),
    new Vector3(10, GROUND + 0.04, WALL_Z),
    new Vector3(10, GROUND + 0.04, -9.2),
    new Vector3(-10, GROUND + 0.04, -9.2),
    PALETTE.gravel,
    up,
  );
  const lift = (x: number) => 0.06 + Math.max(0, Math.abs(x) - 30) * 0.004;
  for (let x = -112; x < 112; x += 2) {
    const z0 = laneZ(x);
    const z1 = laneZ(x + 2);
    painter.quad(
      ground(x, z0 + half, lift(x)),
      ground(x + 2, z1 + half, lift(x + 2)),
      ground(x + 2, z1 - half, lift(x + 2)),
      ground(x, z0 - half, lift(x)),
      PALETTE.road,
      up,
    );
  }
}

/** A box of `size` standing on the ground at (x, z). */
function block(
  painter: Painter,
  x: number,
  z: number,
  w: number,
  h: number,
  depth: number,
  color: Color,
  options: { ry?: number; lift?: number; y?: number } = {},
): void {
  const y = options.y ?? landHeight(x, z) + (options.lift ?? 0);
  painter.solid(unitBox, at(x, y + h / 2, z, { ry: options.ry, sx: w, sy: h, sz: depth }), color);
}

/** A run of hedge from one point to another, in short clipped sections. */
function hedge(painter: Painter, x0: number, z0: number, x1: number, z1: number): void {
  const random = createRandom(Math.round(x0 * 31 + z0 * 17 + x1 * 7 + z1));
  const length = Math.hypot(x1 - x0, z1 - z0);
  const sections = Math.ceil(length / 2.2);
  const ry = Math.atan2(-(z1 - z0), x1 - x0);
  for (let i = 0; i < sections; i++) {
    const t = (i + 0.5) / sections;
    const x = x0 + (x1 - x0) * t;
    const z = z0 + (z1 - z0) * t;
    block(
      painter,
      x,
      z,
      length / sections + 0.05,
      1.15 + random() * 0.2,
      0.9 + random() * 0.15,
      pick(PALETTE.hedge, random),
      { ry, lift: -0.05 },
    );
  }
}

/**
 * The kitchen garden: a hedged plot across the lane with a gate, raised beds either side of a
 * gravel path, a glasshouse lit from inside, and string lights along the front hedge.
 */
function paintGarden(painter: Painter, bulbs: Vector3[]): void {
  const random = createRandom(21);
  const front = -15;
  const back = -35;
  const side = 32;
  const gate = 1.6;
  hedge(painter, -side, front, -gate, front);
  hedge(painter, gate, front, side, front);
  hedge(painter, -side, front, -side, back);
  hedge(painter, side, front, side, back);
  hedge(painter, -side, back, side, back);
  for (const x of [-gate - 0.3, gate + 0.3]) {
    block(painter, x, front, 0.5, 1.6, 0.5, PALETTE.stone);
    block(painter, x, front, 0.62, 0.12, 0.62, PALETTE.stone, { y: GROUND + 1.6 });
  }
  painter.quad(
    ground(-1.1, front, 0.03),
    ground(1.1, front, 0.03),
    ground(1.1, back + 1, 0.03),
    ground(-1.1, back + 1, 0.03),
    PALETTE.gravel,
    new Vector3(0, 1, 0),
  );

  // Raised beds in four rows, each planted with one crop.
  for (const z of [-18.5, -22.5, -26.5, -30.5]) {
    for (const [x0, x1] of [
      [-29, -21],
      [-19.5, -11.5],
      [-10, -2.5],
      [2.5, 10],
      [11.5, 19.5],
      [21, 29],
    ] as const) {
      if (x0 > 20 && z < -25) continue; // the glasshouse
      const x = (x0 + x1) / 2;
      const length = x1 - x0;
      block(painter, x, z, length, 0.35, 1.5, PALETTE.wood);
      block(painter, x, z, length - 0.16, 0.02, 1.34, PALETTE.soil, { lift: 0.34 });
      const crop = Math.floor(random() * 4);
      const color = PALETTE.crops[crop]!;
      const y = landHeight(x, z) + 0.36;
      for (let u = x0 + 0.5; u < x1 - 0.3; u += crop === 2 ? 0.45 : 0.7) {
        for (const row of [-0.35, 0.35]) {
          const s = 0.18 + random() * 0.08;
          const v = z + row;
          if (crop === 2) {
            // Leeks: thin upright tufts.
            painter.solid(
              crown,
              at(u, y + 0.2, v, { sx: 0.07, sy: 0.22 + random() * 0.06, sz: 0.07, ry: random() }),
              color,
            );
          } else if (crop === 3) {
            // Runner beans, grown up canes into leafy columns.
            painter.solid(
              crown,
              at(u, y + 0.5, v, { sx: 0.24, sy: 0.5 + random() * 0.1, sz: 0.24, ry: random() * 3 }),
              color,
            );
          } else {
            painter.solid(
              crown,
              at(u, y + s * 0.6, v, { sx: s * 1.3, sy: s, sz: s * 1.3, ry: random() * 3 }),
              color,
            );
          }
        }
      }
    }
  }

  // The glasshouse, glowing from the lamp inside, its panes ruled by dark glazing bars.
  const gx = 25;
  const gz = -29;
  const gw = 6;
  const gd = 4;
  const eaves = 2.1;
  const ridge = 3.1;
  const gy = landHeight(gx, gz);
  const lit = PALETTE.glasshouse;
  const south = new Vector3(0, 0, 1);
  const corner = (dx: number, y: number, dz: number) => new Vector3(gx + dx, gy + y, gz + dz);
  const hw = gw / 2;
  const hd = gd / 2;
  painter.glow(
    corner(-hw, 0.4, hd),
    corner(hw, 0.4, hd),
    corner(hw, eaves, hd),
    corner(-hw, eaves, hd),
    lit,
    south,
  );
  painter.glow(
    corner(-hw, eaves, hd),
    corner(hw, eaves, hd),
    corner(hw, ridge, 0),
    corner(-hw, ridge, 0),
    lit,
    new Vector3(0, 1, 1),
  );
  for (const sx of [-1, 1]) {
    const out = new Vector3(sx, 0, 0);
    painter.glow(
      corner(sx * hw, 0.4, hd),
      corner(sx * hw, 0.4, -hd),
      corner(sx * hw, eaves, -hd),
      corner(sx * hw, eaves, hd),
      lit,
      out,
    );
    painter.glow(
      corner(sx * hw, eaves, hd),
      corner(sx * hw, eaves, -hd),
      corner(sx * hw, ridge, 0),
      corner(sx * hw, ridge, 0),
      lit,
      out,
    );
  }
  block(painter, gx, gz, gw + 0.1, 0.4, gd + 0.1, PALETTE.stone);
  const bar = PALETTE.post;
  for (let k = 0; k <= 6; k++) {
    const dx = -hw + (k / 6) * gw;
    block(painter, gx + dx, gz + hd + 0.02, 0.06, eaves - 0.4, 0.06, bar, { y: gy + 0.4 });
    painter.solid(
      unitBox,
      at(gx + dx, gy + (eaves + ridge) / 2, gz + hd / 2 + 0.03, {
        sx: 0.06,
        sy: 0.06,
        sz: Math.hypot(hd, ridge - eaves) + 0.05,
        rx: Math.atan2(ridge - eaves, hd),
      }),
      bar,
    );
  }
  block(painter, gx, gz + hd + 0.02, gw, 0.07, 0.07, bar, { y: gy + eaves - 0.035 });
  block(painter, gx, gz + hd + 0.02, gw, 0.07, 0.07, bar, { y: gy + 1.2 });
  block(painter, gx, gz, gw, 0.08, 0.08, bar, { y: gy + ridge - 0.04 });

  // String lights swagged between posts along the front hedge. The bulbs alone draw the strand.
  const top = 2.35;
  const posts = [-30, -24, -18, -12, -6, -gate - 0.3, gate + 0.3, 6, 12, 18, 24, 30];
  const z = front + 0.75;
  for (const x of posts) {
    if (Math.abs(x) > gate + 1) block(painter, x, z, 0.09, top + 0.05, 0.09, PALETTE.post);
  }
  for (let i = 0; i < posts.length - 1; i++) {
    const x0 = posts[i]!;
    const x1 = posts[i + 1]!;
    const count = Math.round((x1 - x0) / 0.75);
    for (let k = 1; k < count; k++) {
      const t = k / count;
      const sag = Math.sin(t * Math.PI) * 0.45;
      const x = x0 + (x1 - x0) * t;
      bulbs.push(new Vector3(x, landHeight(x, z) + top - sag, z));
    }
  }
}

/** Rows of vines on the slope behind the garden. */
function paintVines(painter: Painter): void {
  const random = createRandom(5);
  for (let z = -40; z > -78; z -= 3.2) {
    const reachX = 58 + (z + 40) * 0.3;
    for (let x = -reachX; x < reachX; x += 4) {
      if (Math.abs(x) < 6 && z > -48) continue; // the track up to the farm
      const color = pick(PALETTE.vine, random);
      block(painter, x + 2, z, 3.7, 1.15 + random() * 0.2, 0.55, color, { lift: -0.05 });
    }
  }
}

/** A round broadleaf tree. */
function tree(painter: Painter, x: number, z: number, size: number, random: () => number): void {
  const y = landHeight(x, z);
  painter.solid(
    trunk,
    at(x, y - 0.2, z, { sx: 0.18 * size, sy: size * 1.4, sz: 0.18 * size }),
    PALETTE.bark,
  );
  painter.solid(
    size > 2.2 ? fineCrown : crown,
    at(x, y + size * 1.9, z, { sx: size * 1.25, sy: size, sz: size * 1.2, ry: random() * 3 }),
    pick(PALETTE.leaves, random),
  );
}

/** A Lombardy poplar: a tall, narrow flame. */
function poplar(painter: Painter, x: number, z: number, random: () => number): void {
  const y = landHeight(x, z);
  const h = 8 + random() * 3;
  painter.solid(trunk, at(x, y - 0.2, z, { sx: 0.25, sy: 1.6, sz: 0.25 }), PALETTE.bark);
  painter.solid(
    crown,
    at(x, y + h * 0.55, z, { sx: 1.3, sy: h * 0.5, sz: 1.3, ry: random() * 3 }),
    pick(PALETTE.pine, random),
  );
}

/** A fir on the mountainside. */
function fir(painter: Painter, x: number, z: number, random: () => number): void {
  const h = 6 + random() * 5;
  painter.solid(
    unitCone,
    at(x, landHeight(x, z) - 0.5, z, { sx: h * 0.28, sy: h, sz: h * 0.28, ry: random() * 3 }),
    pick(PALETTE.pine, random),
  );
}

/** True where trees should not grow: the lane, the garden, the vines, the farmyard. */
function cleared(x: number, z: number): boolean {
  if (Math.abs(z - laneZ(x)) < 5) return true;
  if (Math.abs(x) < 36 && z > -39) return true;
  if (z < -37 && z > -80 && Math.abs(x) < 60 + (z + 40) * 0.3) return true;
  if (Math.hypot(x + 40, z + 88) < 14) return true;
  if (Math.hypot(x - 64, z + 84) < 18) return true;
  return false;
}

function paintTrees(painter: Painter): void {
  const random = createRandom(1234);
  // Poplars along the lane where it leaves the garden, both ways.
  for (const sign of [-1, 1]) {
    for (let u = 38; u < 112; u += 7 + random() * 2) {
      const x = sign * u;
      poplar(painter, x, laneZ(x) - 3.2, random);
      if (random() < 0.6) poplar(painter, x + sign * 3, laneZ(x) + 3.4, random);
    }
  }
  // Copses on the hills: trees in clusters, and a few on their own.
  const clusters = Array.from({ length: 22 }, () => {
    const t = (random() - 0.5) * Math.PI * 0.98;
    const r = 45 + random() * 85;
    return [Math.sin(t) * r, WALL_Z - Math.cos(t) * r, 6 + random() * 10] as const;
  });
  for (const [cx, cz, spread] of clusters) {
    const count = 6 + Math.floor(random() * 10);
    for (let i = 0; i < count; i++) {
      const x = cx + (random() - 0.5) * spread * 2;
      const z = cz + (random() - 0.5) * spread * 2;
      if (cleared(x, z) || z > WALL_Z - 4) continue;
      tree(painter, x, z, 1.6 + random() * 1.4, random);
    }
  }
  for (let i = 0; i < 70; i++) {
    const t = (random() - 0.5) * Math.PI * 0.98;
    const r = 38 + random() * 80;
    const x = Math.sin(t) * r;
    const z = WALL_Z - Math.cos(t) * r;
    if (cleared(x, z) || z > WALL_Z - 4) continue;
    tree(painter, x, z, 1.4 + random() * 1.2, random);
  }
  // Fir forest up the lower mountainsides.
  for (let i = 0; i < 420; i++) {
    const t = (random() - 0.5) * Math.PI;
    const r = 100 + random() * 40;
    const x = Math.sin(t) * r;
    const z = WALL_Z - Math.cos(t) * r;
    // Clear of the bare rock, and of the wall line, so no tree reaches round behind the kitchen.
    if (landHeight(x, z) - GROUND > 24 || z > WALL_Z - 8) continue;
    fir(painter, x, z, random);
  }
}

/** A house: walls, a pitched roof, a chimney, and its lit windows facing the kitchen. */
function house(
  painter: Painter,
  x: number,
  z: number,
  w: number,
  depth: number,
  h: number,
  options: { walls?: Color; roof?: Color; windows?: readonly (readonly [number, number])[] } = {},
): void {
  // On a slope the walls stand on the high side and run down into the ground on the low side.
  const corners = [-1, 1].flatMap((sx) =>
    [-1, 1].map((sz) => landHeight(x + (sx * w) / 2, z + (sz * depth) / 2)),
  );
  const base = Math.min(...corners) - 0.4;
  const y = Math.max(...corners);
  const walls = options.walls ?? PALETTE.plaster;
  const roof = options.roof ?? PALETTE.roof;
  const tall = y + h - base;
  painter.solid(unitBox, at(x, base + tall / 2, z, { sx: w, sy: tall, sz: depth }), walls);
  // The roof: two slopes over the long walls and a gable at each end.
  const rise = depth * 0.42;
  const eaves = y + h;
  const hw = w / 2 + 0.25;
  const hd = depth / 2 + 0.3;
  const p = (dx: number, dy: number, dz: number) => new Vector3(x + dx, eaves + dy, z + dz);
  painter.quad(
    p(-hw, 0, hd),
    p(hw, 0, hd),
    p(hw, rise, 0),
    p(-hw, rise, 0),
    roof,
    new Vector3(0, 1, 1),
  );
  painter.quad(
    p(-hw, 0, -hd),
    p(hw, 0, -hd),
    p(hw, rise, 0),
    p(-hw, rise, 0),
    roof,
    new Vector3(0, 1, -1),
  );
  for (const sx of [-1, 1]) {
    painter.face(
      p((sx * w) / 2, 0, depth / 2),
      p((sx * w) / 2, 0, -depth / 2),
      p((sx * w) / 2, rise, 0),
      walls,
      new Vector3(sx, 0, 0),
    );
  }
  painter.solid(
    unitBox,
    at(x + w * 0.3, eaves + rise * 0.6, z - depth * 0.1, { sx: 0.7, sy: rise + 0.9, sz: 0.7 }),
    PALETTE.stone,
  );
  const south = new Vector3(0, 0, 1);
  for (const [u, v] of options.windows ?? []) {
    const wx = x + u * w;
    const wy = y + v * h;
    const wz = z + depth / 2 + 0.03;
    painter.glow(
      new Vector3(wx - 0.4, wy - 0.55, wz),
      new Vector3(wx + 0.4, wy - 0.55, wz),
      new Vector3(wx + 0.4, wy + 0.55, wz),
      new Vector3(wx - 0.4, wy + 0.55, wz),
      PALETTE.lamplight,
      south,
    );
  }
}

/** The farm up the track behind the vines, and a village with a steeple across the valley. */
function paintHomes(painter: Painter): void {
  house(painter, -40, -88, 12, 7, 5.2, {
    windows: [
      [-0.3, 0.3],
      [0.05, 0.3],
      [-0.3, 0.75],
      [0.32, 0.75],
    ],
  });
  house(painter, -26, -92, 8, 6, 4, {
    walls: PALETTE.stone,
    roof: PALETTE.slate,
    windows: [[-0.2, 0.35]],
  });
  const random = createRandom(88);
  const village: readonly (readonly [number, number])[] = [
    [56, -74],
    [63, -78],
    [71, -73],
    [52, -83],
    [60, -86],
    [69, -85],
    [78, -80],
  ];
  for (const [x, z] of village) {
    house(painter, x, z, 5 + random() * 3, 5, 4 + random() * 2, {
      walls: random() < 0.5 ? PALETTE.plaster : PALETTE.stone,
      roof: random() < 0.6 ? PALETTE.roof : PALETTE.slate,
      windows: random() < 0.75 ? [[random() - 0.5, 0.4]] : [],
    });
  }
  // The church, its steeple standing over the roofs.
  house(painter, 62, -96, 7, 13, 7, {
    walls: PALETTE.stone,
    roof: PALETTE.slate,
    windows: [[0, 0.5]],
  });
  const sy = landHeight(62, -89) - 0.5;
  painter.solid(unitBox, at(62, sy + 7, -89, { sx: 3, sy: 14, sz: 3 }), PALETTE.stone);
  painter.solid(
    unitCone,
    at(62, sy + 14, -89, { sx: 2.3, sy: 7, sz: 2.3, ry: Math.PI / 4 }),
    PALETTE.slate,
  );
}

/** Planters of herbs along the foot of the kitchen wall, under the windows. */
function paintPlanters(painter: Painter): void {
  const random = createRandom(9);
  for (const x of [-5.5, 0, 5.5]) {
    block(painter, x, WALL_Z - 0.6, 3, 0.55, 0.7, PALETTE.terracotta, { y: GROUND });
    for (let u = x - 1.2; u <= x + 1.25; u += 0.4) {
      const s = 0.2 + random() * 0.08;
      painter.solid(
        crown,
        at(u, GROUND + 0.6, WALL_Z - 0.6 + (random() - 0.5) * 0.2, {
          sx: s,
          sy: s * 1.2,
          sz: s,
          ry: random() * 3,
        }),
        pick(PALETTE.crops, random),
      );
    }
  }
}

export interface Outside {
  /** The whole view, with its colors baked in. */
  readonly geometry: BufferGeometry;
  /** Where the string lights' bulbs hang. */
  readonly bulbs: readonly Vector3[];
}

/** Paint everything outside the north windows. */
export function paintOutside(): Outside {
  const painter = new Painter();
  const bulbs: Vector3[] = [];
  paintSky(painter);
  paintNight(painter);
  paintLand(painter);
  paintLane(painter);
  paintPlanters(painter);
  paintGarden(painter, bulbs);
  paintVines(painter);
  paintTrees(painter);
  paintHomes(painter);
  return { geometry: painter.build(), bulbs };
}

/** Add the view outside to the kitchen: one unlit layer, and the string lights on `light`. */
export function buildOutside(kit: Kit): void {
  const { geometry, bulbs } = paintOutside();
  kit.add('outside', geometry);
  for (const bulb of bulbs)
    kit.sphere('light', bulb.x, bulb.y, bulb.z, 0.045, { color: '#e09a52' });
}
