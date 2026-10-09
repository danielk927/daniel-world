import { BufferGeometry, Color, Float32BufferAttribute, Vector3 } from 'three';

/**
 * Shapes for food that primitives cannot make: a croissant's crescent of rolled dough, a piped
 * kiss of whipped cheese, a wedge cut from a round root. Each is a smooth surface with its texture
 * coordinates in meters and, where the shape's color changes over it (a croissant browns on its
 * crests and stays pale in its folds), its own vertex colors, which the Kit keeps.
 */

/** A point on a swept surface: where the section's middle is, and the radius at an angle round it. */
export interface Sweep {
  /** The centerline at t in [0, 1]. */
  readonly path: (t: number, out: Vector3) => Vector3;
  /** The section's radius at t, at angle `around` (0 is straight up). */
  readonly radius: (t: number, around: number) => number;
  /** A color at t and angle, or none to leave the part to its paint. */
  readonly color?: (t: number, around: number, out: Color) => Color;
  /** Points along and round. */
  readonly along: number;
  readonly round: number;
  /** Squash the section's underside flat at this fraction of its radius below the centerline. */
  readonly flatBelow?: number;
}

const up = new Vector3(0, 1, 0);
const east = new Vector3(1, 0, 0);

/** Turn every triangle of `geometry` to face away from `inside`, a point within a convex shape. */
function faceAwayFrom(geometry: BufferGeometry, inside: Vector3): void {
  const position = geometry.getAttribute('position');
  const index = geometry.index!;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(position, index.getX(i));
    b.fromBufferAttribute(position, index.getX(i + 1));
    c.fromBufferAttribute(position, index.getX(i + 2));
    n.subVectors(b, a).cross(c.clone().sub(a));
    const centroid = a.clone().add(b).add(c).divideScalar(3).sub(inside);
    if (n.dot(centroid) < 0) {
      const second = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, second);
    }
  }
  geometry.computeVertexNormals();
}

/** A tube swept along a path, closed at both ends by drawing its radius to nothing there. */
export function sweepGeometry(sweep: Sweep): BufferGeometry {
  const { along, round } = sweep;
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  const center = new Vector3();
  const ahead = new Vector3();
  const tangent = new Vector3();
  const side = new Vector3();
  const normal = new Vector3();
  const point = new Vector3();
  const color = new Color();
  let length = 0;
  const last = new Vector3();
  for (let i = 0; i <= along; i++) {
    const t = i / along;
    sweep.path(t, center);
    if (i > 0) length += center.distanceTo(last);
    last.copy(center);
    sweep.path(Math.min(1, t + 1e-3), ahead);
    sweep.path(Math.max(0, t - 1e-3), tangent);
    tangent.subVectors(ahead, tangent).normalize();
    // Measured from up, or from east for a path that runs straight up.
    side.crossVectors(tangent, Math.abs(tangent.y) > 0.99 ? east : up).normalize();
    normal.crossVectors(side, tangent).normalize();
    for (let j = 0; j <= round; j++) {
      const around = (j / round) * Math.PI * 2;
      const r = sweep.radius(t, around);
      let dy = Math.cos(around) * r;
      if (sweep.flatBelow !== undefined) dy = Math.max(dy, -sweep.flatBelow * r);
      point
        .copy(center)
        .addScaledVector(normal, dy)
        .addScaledVector(side, Math.sin(around) * r);
      positions.push(point.x, point.y, point.z);
      uvs.push(length, (j / round) * Math.PI * 2 * 0.03);
      if (sweep.color) {
        sweep.color(t, around, color);
        colors.push(color.r, color.g, color.b);
      }
    }
  }
  for (let i = 0; i < along; i++) {
    for (let j = 0; j < round; j++) {
      const a = i * (round + 1) + j;
      const b = a + round + 1;
      // Wound to face out of the tube.
      index.push(a, a + 1, b, b, a + 1, b + 1);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  if (colors.length) geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}

const golden = new Color('#c98236');
const crest = new Color('#e0a352');
const fold = new Color('#7a4216');
const tip = new Color('#9a5420');

/**
 * A croissant lying on its back, curved round its middle (the origin) toward +z: seven rolls of
 * laminated dough round a crescent, plump in the middle and tapering to the tips, browned on the crests and
 * pale in the folds between them, flat underneath. About 17 cm from tip to tip.
 */
export function croissantGeometry(): BufferGeometry {
  const bend = 0.078;
  const sweepAngle = 2.5;
  const rolls = 7;
  return sweepGeometry({
    along: 70,
    round: 20,
    flatBelow: 0.55,
    path: (t, out) => {
      const a = (t - 0.5) * sweepAngle;
      return out.set(Math.sin(a) * bend, 0, Math.cos(a) * bend);
    },
    radius: (t, around) => {
      const middle = 1 - Math.pow(Math.abs(2 * t - 1), 1.8) * 0.82;
      const band = Math.pow(Math.abs(Math.sin(Math.PI * rolls * t)), 0.45);
      // The rolls show most on top, less underneath.
      const show = 0.55 + 0.45 * Math.max(0, Math.cos(around));
      return 0.046 * middle * (1 - 0.13 * show * (1 - band)) * (t < 0.01 || t > 0.99 ? 0.2 : 1);
    },
    color: (t, around, out) => {
      const band = Math.pow(Math.abs(Math.sin(Math.PI * rolls * t)), 0.45);
      const top = Math.max(0, Math.cos(around));
      out
        .copy(fold)
        .lerp(golden, band)
        .lerp(crest, band * top * 0.7);
      const end = Math.pow(Math.abs(2 * t - 1), 3);
      return out.lerp(tip, end * 0.6);
    },
  });
}

/**
 * A kiss of whipped ricotta piped through a star tip: a round foot rising to a soft point, its
 * ridges twisting as the bag turned. Stands on y = 0.
 */
export function pipedKiss(radius: number, height: number): BufferGeometry {
  return sweepGeometry({
    along: 10,
    round: 18,
    path: (t, out) => out.set(0, t * height, 0),
    radius: (t, around) => {
      const profile =
        Math.pow(Math.max(0, 1 - Math.pow(t, 1.5)), 0.75) * (t < 0.04 ? 0.6 + t * 10 : 1);
      return radius * profile * (1 + 0.14 * Math.cos(6 * around + t * 4));
    },
  });
}

/**
 * A wedge cut from a round root, lying on its side: the dome of its skin and the two cut faces, as
 * separate geometries so they can be painted apart. `angle` is how much of the round it is.
 */
export function wedgeGeometry(
  radius: number,
  angle: number,
): { skin: BufferGeometry; cut: BufferGeometry } {
  const rows = 10;
  const columns = 14;
  const skinPositions: number[] = [];
  const skinIndex: number[] = [];
  for (let i = 0; i <= rows; i++) {
    const theta = (i / rows) * (Math.PI / 2);
    for (let j = 0; j <= columns; j++) {
      const phi = (j / columns) * angle;
      skinPositions.push(
        radius * Math.sin(theta) * Math.cos(phi),
        radius * Math.cos(theta) * 0.85,
        -radius * Math.sin(theta) * Math.sin(phi),
      );
    }
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < columns; j++) {
      const a = i * (columns + 1) + j;
      const b = a + columns + 1;
      skinIndex.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const skin = new BufferGeometry();
  skin.setAttribute('position', new Float32BufferAttribute(skinPositions, 3));
  skin.setIndex(skinIndex);
  // Inside the wedge, near its middle.
  const inside = new Vector3(
    radius * 0.4 * Math.cos(angle / 2),
    radius * 0.25,
    -radius * 0.4 * Math.sin(angle / 2),
  );
  faceAwayFrom(skin, new Vector3(0, 0, 0));
  // The two cut faces: quarter discs from the axis out to the rim, at either side of the wedge.
  const cutPositions: number[] = [];
  const cutIndex: number[] = [];
  for (const phi of [0, angle]) {
    const base = cutPositions.length / 3;
    cutPositions.push(0, 0, 0);
    for (let i = 0; i <= rows; i++) {
      const theta = (i / rows) * (Math.PI / 2);
      cutPositions.push(
        radius * Math.sin(theta) * Math.cos(phi),
        radius * Math.cos(theta) * 0.85,
        -radius * Math.sin(theta) * Math.sin(phi),
      );
    }
    for (let i = 0; i < rows; i++) cutIndex.push(base, base + i + 1, base + i + 2);
  }
  const cut = new BufferGeometry();
  cut.setAttribute('position', new Float32BufferAttribute(cutPositions, 3));
  cut.setIndex(cutIndex);
  faceAwayFrom(cut, inside);
  return { skin, cut };
}

/** Smooth value noise over the plane, about 0 to 1, seeded. */
function valueNoise(seed: number): (x: number, y: number) => number {
  const table = new Float32Array(256);
  let state = seed * 2654435761;
  for (let i = 0; i < 256; i++) {
    state = (Math.imul(state ^ (state >>> 15), 2246822507) + 0x9e3779b9) | 0;
    table[i] = ((state >>> 0) % 10000) / 10000;
  }
  const at = (i: number, j: number): number => table[(i * 31 + j * 17 + ((i * j) & 7)) & 255]!;
  return (x, y) => {
    const i = Math.floor(x);
    const j = Math.floor(y);
    const u = x - i;
    const v = y - j;
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * su;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * su;
    return a + (b - a) * sv;
  };
}

const dough = new Color('#e2b675');
const blister = new Color('#8f4b1a');
const toasted = new Color('#c48a4a');

/**
 * A flaky flatbread, a roti or a paratha: a soft round, wrinkled and folding up at its ragged edge,
 * a few millimeters thick, browned in blisters where it met the griddle. Lies on y = 0.
 */
export function flatbreadGeometry(radius: number, seed: number): BufferGeometry {
  const noise = valueNoise(seed);
  const rings = 8;
  const spokes = 36;
  const thick = 0.004;
  const positions: number[] = [];
  const colors: number[] = [];
  const index: number[] = [];
  const color = new Color();
  const edge = (theta: number): number =>
    radius * (0.9 + 0.16 * noise(Math.cos(theta) * 2.2 + 5, Math.sin(theta) * 2.2 + 5));
  // The top sheet, then the bottom one under it.
  for (const side of [1, -1]) {
    for (let i = 0; i <= rings; i++) {
      for (let j = 0; j < spokes; j++) {
        const theta = (j / spokes) * Math.PI * 2;
        const f = i / rings;
        const r = edge(theta) * f;
        const x = Math.cos(theta) * r;
        const z = Math.sin(theta) * r;
        const wrinkle = (noise(x * 40 + 1, z * 40 + 1) - 0.5) * 0.006 * f;
        const lift =
          0.012 * Math.pow(f, 4) * noise(Math.cos(theta) * 3 + 9, Math.sin(theta) * 3 + 9);
        const y = thick + wrinkle + lift + (side < 0 ? -thick * (1 - f * 0.6) : 0);
        positions.push(x, Math.max(0.0005, y), z);
        const spots = Math.max(0, noise(x * 55 + 3, z * 55 + 3) - 0.62) * 2.6;
        color
          .copy(dough)
          .lerp(toasted, 0.35 * f + 0.3 * noise(x * 12, z * 12))
          .lerp(blister, Math.min(1, spots));
        colors.push(color.r, color.g, color.b);
      }
    }
  }
  const sheet = (rings + 1) * spokes;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < spokes; j++) {
      const a = i * spokes + j;
      const b = i * spokes + ((j + 1) % spokes);
      const c = a + spokes;
      const d = b + spokes;
      // Top facing up, bottom facing down.
      index.push(a, d, c, a, b, d);
      index.push(sheet + a, sheet + c, sheet + d, sheet + a, sheet + d, sheet + b);
    }
  }
  // The edge between them.
  for (let j = 0; j < spokes; j++) {
    const a = rings * spokes + j;
    const b = rings * spokes + ((j + 1) % spokes);
    index.push(a, sheet + b, sheet + a, a, b, sheet + b);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  geometry.setIndex(index);
  geometry.computeVertexNormals();
  return geometry;
}
