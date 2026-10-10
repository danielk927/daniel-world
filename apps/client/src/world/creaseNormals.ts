import { Float32BufferAttribute, type BufferGeometry } from 'three';

/**
 * Smooth normals that keep a model's creases, for a non-indexed geometry (three triangles' worth
 * of corners each, as the knives and the hand are built): each corner's normal averages the faces
 * round its point that lie within `crease` radians of its own face, so what is curved shades round
 * and what is creased (a blade's spine, its edge, the butt of a handle) stays sharp.
 *
 * Each face counts by the area of the flat it belongs to (face-weighted normals): a narrow chamfer
 * between two broad faces takes their normals at its two edges, so it shades as a rounded edge
 * between them while the broad faces stay flat. Nothing moves, only the normals change.
 */
export function creaseNormals(geometry: BufferGeometry, crease: number): void {
  const position = geometry.getAttribute('position');
  const count = position.count;
  const triangles = Math.floor(count / 3);

  // Weld corners that share a point, so faces can find their neighbours.
  const ids = new Int32Array(count);
  const known = new Map<string, number>();
  for (let i = 0; i < count; i++) {
    const key = `${Math.round(position.getX(i) * 1e7)},${Math.round(position.getY(i) * 1e7)},${Math.round(position.getZ(i) * 1e7)}`;
    let id = known.get(key);
    if (id === undefined) {
      id = known.size;
      known.set(key, id);
    }
    ids[i] = id;
  }

  // Each face's normal and area.
  const normals = new Float64Array(triangles * 3);
  const areas = new Float64Array(triangles);
  for (let t = 0; t < triangles; t++) {
    const a = t * 3;
    const ax = position.getX(a);
    const ay = position.getY(a);
    const az = position.getZ(a);
    const ux = position.getX(a + 1) - ax;
    const uy = position.getY(a + 1) - ay;
    const uz = position.getZ(a + 1) - az;
    const vx = position.getX(a + 2) - ax;
    const vy = position.getY(a + 2) - ay;
    const vz = position.getZ(a + 2) - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz);
    areas[t] = length / 2;
    if (length > 0) {
      normals[t * 3] = nx / length;
      normals[t * 3 + 1] = ny / length;
      normals[t * 3 + 2] = nz / length;
    }
  }

  // Faces joined edge to edge in one plane are one flat, whose whole area weighs its normal.
  const flat = new Int32Array(triangles).map((_, t) => t);
  const root = (t: number): number => {
    while (flat[t] !== t) t = flat[t] = flat[flat[t]!]!;
    return t;
  };
  const coplanar = Math.cos((0.5 * Math.PI) / 180);
  const edges = new Map<string, number>();
  for (let t = 0; t < triangles; t++) {
    if (areas[t] === 0) continue;
    for (let k = 0; k < 3; k++) {
      const p = ids[t * 3 + k]!;
      const q = ids[t * 3 + ((k + 1) % 3)]!;
      const key = p < q ? `${p},${q}` : `${q},${p}`;
      const other = edges.get(key);
      if (other === undefined) {
        edges.set(key, t);
        continue;
      }
      // Against each flat's first face, so a gentle curve never creeps into one flat face by face.
      const a = root(t);
      const b = root(other);
      const dot =
        normals[a * 3]! * normals[b * 3]! +
        normals[a * 3 + 1]! * normals[b * 3 + 1]! +
        normals[a * 3 + 2]! * normals[b * 3 + 2]!;
      if (a !== b && dot > coplanar) flat[a] = b;
    }
  }
  const flatArea = new Float64Array(triangles);
  for (let t = 0; t < triangles; t++) flatArea[root(t)]! += areas[t]!;

  // The flats round each point, once each.
  const around = new Map<number, number[]>();
  for (let t = 0; t < triangles; t++) {
    if (areas[t] === 0) continue;
    const f = root(t);
    for (let k = 0; k < 3; k++) {
      const id = ids[t * 3 + k]!;
      let flats = around.get(id);
      if (!flats) around.set(id, (flats = []));
      if (!flats.includes(f)) flats.push(f);
    }
  }

  const out = new Float32Array(count * 3);
  const limit = Math.cos(crease);
  for (let t = 0; t < triangles; t++) {
    const nx = normals[t * 3]!;
    const ny = normals[t * 3 + 1]!;
    const nz = normals[t * 3 + 2]!;
    for (let k = 0; k < 3; k++) {
      const i = t * 3 + k;
      let sx = 0;
      let sy = 0;
      let sz = 0;
      for (const f of around.get(ids[i]!) ?? []) {
        const fx = normals[f * 3]!;
        const fy = normals[f * 3 + 1]!;
        const fz = normals[f * 3 + 2]!;
        if (fx * nx + fy * ny + fz * nz < limit) continue;
        const w = flatArea[f]!;
        sx += fx * w;
        sy += fy * w;
        sz += fz * w;
      }
      const length = Math.hypot(sx, sy, sz);
      if (length > 0) {
        out[i * 3] = sx / length;
        out[i * 3 + 1] = sy / length;
        out[i * 3 + 2] = sz / length;
      } else {
        out[i * 3] = nx;
        out[i * 3 + 1] = ny;
        out[i * 3 + 2] = nz;
      }
    }
  }
  geometry.setAttribute('normal', new Float32BufferAttribute(out, 3));
}
