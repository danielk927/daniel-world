import {
  BufferGeometry,
  CylinderGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  Path,
  Shape,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';

/**
 * A small kit for modeling knives out of primitives, low-poly and faceted like the kitchen.
 *
 * Everything is drawn in side view: a point is `[z, y]`, with the knife lying along +Z from its tip
 * (at the origin) to its butt, the spine up (+Y) and the edge down, and the flat of the blade
 * facing ±X. Parts are extruded across X from these outlines, so the same outlines also draw the
 * knife's silhouette for its icon.
 */

export type V2 = readonly [z: number, y: number];

/**
 * How a part is colored. `blade` and `metal` parts wear the finish (a strip of the shared finish
 * texture); `grip`, `steel` and `accent` parts are one plain color each.
 */
export type PartKind = 'blade' | 'metal' | 'grip' | 'steel' | 'accent';

/** A closed outline in side view; holes are cut out of the outline before them. */
export interface Loop {
  readonly points: readonly V2[];
  readonly hole: boolean;
}

/** A hinge: the part turns about the X axis through `pivot`, by a pose channel. */
export interface Joint {
  readonly channel: 'a' | 'b';
  readonly pivot: V2;
  /** Which way a positive channel turns it. */
  readonly sign: 1 | -1;
  /** The part this one is carried by, if it hangs off another moving part. */
  readonly parent?: string;
}

export interface KnifePart {
  readonly name: string;
  readonly kind: PartKind;
  /** The color of a grip, steel or accent part (sRGB hex). */
  readonly color?: string;
  /** Model space, non-indexed: position and normal. Finishes add uv and color. */
  readonly geometry: BufferGeometry;
  /** Side silhouette, for the knife's icon. */
  readonly outline: readonly Loop[];
  readonly joint?: Joint;
}

export type PartShape = Pick<KnifePart, 'geometry' | 'outline'>;

/** Linear interpolation of a polyline's y at `z`, clamped to its ends. Points run in z order. */
export function yAt(line: readonly V2[], z: number): number {
  if (z <= line[0]![0]) return line[0]![1];
  for (let i = 1; i < line.length; i++) {
    const [z1, y1] = line[i]!;
    if (z <= z1) {
      const [z0, y0] = line[i - 1]!;
      return z1 === z0 ? y1 : y0 + ((y1 - y0) * (z - z0)) / (z1 - z0);
    }
  }
  return line[line.length - 1]![1];
}

/** Collects triangles, each wound to face `outward`, into a non-indexed geometry. */
class TriangleSoup {
  private readonly positions: number[] = [];
  private readonly ab = new Vector3();
  private readonly ac = new Vector3();
  private readonly n = new Vector3();

  tri(a: Vector3, b: Vector3, c: Vector3, outward: Vector3): void {
    this.n.crossVectors(this.ab.subVectors(b, a), this.ac.subVectors(c, a));
    if (this.n.lengthSq() < 1e-16) return;
    const [p, q] = this.n.dot(outward) >= 0 ? [b, c] : [c, b];
    this.positions.push(a.x, a.y, a.z, p.x, p.y, p.z, q.x, q.y, q.z);
  }

  quad(a: Vector3, b: Vector3, c: Vector3, d: Vector3, outward: Vector3): void {
    this.tri(a, b, c, outward);
    this.tri(a, c, d, outward);
  }

  geometry(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.computeVertexNormals();
    return geometry;
  }
}

const vectors = (points: readonly V2[]): Vector2[] => points.map(([z, y]) => new Vector2(z, y));

function toShape(points: readonly V2[], holes: readonly (readonly V2[])[] = []): Shape {
  const shape = new Shape(vectors(points));
  for (const hole of holes) shape.holes.push(new Path(vectors(hole)));
  return shape;
}

/** The same geometry without an index (three.js primitives come indexed; extrusions do not). */
function unindexed(geometry: BufferGeometry): BufferGeometry {
  if (geometry.index === null) return geometry;
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  return flat;
}

/**
 * An outline extruded `thickness` across X, centered on `x`, its edges chamfered by `bevel`.
 * The chamfer stays inside the outline, so the silhouette is exactly the outline.
 */
export function slab(
  points: readonly V2[],
  thickness: number,
  options: { x?: number; bevel?: number; holes?: readonly (readonly V2[])[] } = {},
): PartShape {
  const bevel = Math.min(options.bevel ?? 0.0015, thickness * 0.3);
  const holes = options.holes ?? [];
  const extruded = new ExtrudeGeometry(toShape(points, holes), {
    depth: thickness - bevel * 2,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments: 1,
    curveSegments: 1,
  });
  extruded.translate(0, 0, -(thickness - bevel * 2) / 2);
  // Shape x, y, depth -> model z, y, x (a quarter turn about Y).
  extruded.rotateY(-Math.PI / 2);
  extruded.translate(options.x ?? 0, 0, 0);
  const geometry = unindexed(extruded);
  geometry.deleteAttribute('uv');
  geometry.computeVertexNormals();
  return {
    geometry,
    outline: [{ points, hole: false }, ...holes.map((hole) => ({ points: hole, hole: true }))],
  };
}

/** A box spanning z0..z1 and y0..y1, `thickness` across X. */
export function box(
  z0: number,
  z1: number,
  y0: number,
  y1: number,
  thickness: number,
  options: { x?: number; bevel?: number } = {},
): PartShape {
  return slab(
    [
      [z0, y0],
      [z1, y0],
      [z1, y1],
      [z0, y1],
    ],
    thickness,
    { bevel: 0, ...options },
  );
}

/** Points round a circle (or an arc from `from` to `to` radians), counterclockwise in side view. */
export function arc(
  center: V2,
  radius: number,
  segments: number,
  from = 0,
  to = Math.PI * 2,
): V2[] {
  const full = Math.abs(to - from - Math.PI * 2) < 1e-9;
  const count = full ? segments : segments + 1;
  const points: V2[] = [];
  for (let i = 0; i < count; i++) {
    const a = from + ((to - from) * i) / segments;
    points.push([center[0] + Math.cos(a) * radius, center[1] + Math.sin(a) * radius]);
  }
  return points;
}

/** A flat ring in side view, like a karambit's finger ring. */
export function ring(
  center: V2,
  outer: number,
  inner: number,
  thickness: number,
  segments = 14,
): PartShape {
  return slab(arc(center, outer, segments), thickness, {
    holes: [arc(center, inner, segments).reverse()],
    bevel: Math.min(0.0018, (outer - inner) * 0.25),
  });
}

/** A rounded slot, from `z0` to `z1` and `y0` to `y1`, for holes. */
export function slot(z0: number, z1: number, y0: number, y1: number, segments = 4): V2[] {
  const r = (y1 - y0) / 2;
  const y = (y0 + y1) / 2;
  return [
    ...arc([z1 - r, y], r, segments, -Math.PI / 2, Math.PI / 2),
    ...arc([z0 + r, y], r, segments, Math.PI / 2, (Math.PI * 3) / 2),
  ];
}

/** A ring whose axis runs along the knife, like a bayonet's muzzle ring. */
export function muzzleRing(center: V2, radius: number, tube: number): PartShape {
  const geometry = unindexed(new TorusGeometry(radius, tube, 4, 10));
  geometry.deleteAttribute('uv');
  geometry.translate(0, center[1], center[0]);
  geometry.computeVertexNormals();
  const [z, y] = center;
  const r = radius + tube;
  return {
    geometry,
    outline: [
      {
        points: [
          [z - tube, y - r],
          [z + tube, y - r],
          [z + tube, y + r],
          [z - tube, y + r],
        ],
        hole: false,
      },
    ],
  };
}

/** A pin through the handle, across X. */
export function pin(center: V2, radius: number, length: number): PartShape {
  const geometry = unindexed(new CylinderGeometry(radius, radius, length, 6));
  geometry.deleteAttribute('uv');
  geometry.rotateZ(Math.PI / 2);
  geometry.translate(0, center[1], center[0]);
  geometry.computeVertexNormals();
  return { geometry, outline: [{ points: arc(center, radius, 6), hole: false }] };
}

export interface BladeSpec {
  /** The back of the blade, from the tip to the base, in z order. */
  readonly spine: readonly V2[];
  /** The sharp edge, from the tip to the base, in z order. Both lines start at the tip. */
  readonly edge: readonly V2[];
  readonly thickness: number;
  /** How far up from the edge toward the spine the bevel is ground (0 to 1). */
  readonly grind?: number;
  /** Holes through the flat of the blade (above the grind), like a thumb hole. */
  readonly holes?: readonly (readonly V2[])[];
}

/**
 * A blade: a flat slab from the spine down to the grind line, and from there a bevel down to a
 * sharp edge, so the light catches the grind as on a real knife.
 */
export function blade(spec: BladeSpec): PartShape {
  const { spine, edge, thickness } = spec;
  const grind = spec.grind ?? 0.42;
  const end = Math.min(spine[spine.length - 1]![0], edge[edge.length - 1]![0]);
  // Stations along the blade: wherever either line has a corner.
  const zs = [...new Set([...spine, ...edge].map(([z]) => z).filter((z) => z <= end))].sort(
    (a, b) => a - b,
  );
  const grindLine: V2[] = zs.map((z) => {
    const e = yAt(edge, z);
    return [z, e + (yAt(spine, z) - e) * grind];
  });

  // The flat, from the grind line round the spine, with any holes through it.
  const flatOutline: V2[] = [...grindLine, ...zs.map((z): V2 => [z, yAt(spine, z)]).reverse()];
  const flat = slab(dedupe(flatOutline), thickness, { bevel: 0, holes: spec.holes ?? [] });

  // The bevel, station by station: from the grind line (full thickness) to the edge (almost none).
  const soup = new TriangleSoup();
  const half = thickness / 2;
  const edgeHalf = half * 0.08;
  const g0 = new Vector3();
  const g1 = new Vector3();
  const e0 = new Vector3();
  const e1 = new Vector3();
  const out = new Vector3();
  const down = new Vector3();
  for (let i = 0; i < zs.length - 1; i++) {
    const za = zs[i]!;
    const zb = zs[i + 1]!;
    const ga = grindLine[i]![1];
    const gb = grindLine[i + 1]![1];
    const ea = yAt(edge, za);
    const eb = yAt(edge, zb);
    for (const side of [1, -1]) {
      out.set(side, 0, 0);
      g0.set(side * half, ga, za);
      g1.set(side * half, gb, zb);
      e0.set(side * edgeHalf, ea, za);
      e1.set(side * edgeHalf, eb, zb);
      soup.quad(g0, g1, e1, e0, out);
    }
    // The thin strip along the edge itself.
    down.set(0, (ea + eb) / 2 - (ga + gb) / 2, 0);
    soup.quad(
      e0.set(edgeHalf, ea, za),
      e1.set(edgeHalf, eb, zb),
      g1.set(-edgeHalf, eb, zb),
      g0.set(-edgeHalf, ea, za),
      down,
    );
  }
  // Close the bevel's back end.
  const zEnd = zs[zs.length - 1]!;
  const gEnd = grindLine[grindLine.length - 1]![1];
  const eEnd = yAt(edge, zEnd);
  out.set(0, 0, 1);
  soup.quad(
    g0.set(half, gEnd, zEnd),
    g1.set(-half, gEnd, zEnd),
    e1.set(-edgeHalf, eEnd, zEnd),
    e0.set(edgeHalf, eEnd, zEnd),
    out,
  );
  const bevel = soup.geometry();

  const geometry = mergeNonIndexed([flat.geometry, bevel]);
  flat.geometry.dispose();
  bevel.dispose();
  const outline: V2[] = dedupe([
    ...zs.map((z): V2 => [z, yAt(edge, z)]),
    ...zs.map((z): V2 => [z, yAt(spine, z)]).reverse(),
  ]);
  return {
    geometry,
    outline: [
      { points: outline, hole: false },
      ...(spec.holes ?? []).map((points) => ({ points, hole: true })),
    ],
  };
}

/** Drop repeated points (the tip, where both lines meet). */
function dedupe(points: readonly V2[]): V2[] {
  const out: V2[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last[0] - p[0]) > 1e-9 || Math.abs(last[1] - p[1]) > 1e-9) out.push(p);
  }
  const first = out[0]!;
  const last = out[out.length - 1]!;
  if (out.length > 1 && Math.abs(first[0] - last[0]) < 1e-9 && Math.abs(first[1] - last[1]) < 1e-9)
    out.pop();
  return out;
}

/** Concatenate non-indexed geometries' positions and normals. */
export function mergeNonIndexed(geometries: readonly BufferGeometry[]): BufferGeometry {
  let count = 0;
  for (const g of geometries) count += g.getAttribute('position').count;
  const position = new Float32Array(count * 3);
  const normal = new Float32Array(count * 3);
  let offset = 0;
  for (const g of geometries) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    position.set(p.array, offset * 3);
    normal.set(n.array, offset * 3);
    offset += p.count;
  }
  const merged = new BufferGeometry();
  merged.setAttribute('position', new Float32BufferAttribute(position, 3));
  merged.setAttribute('normal', new Float32BufferAttribute(normal, 3));
  return merged;
}
