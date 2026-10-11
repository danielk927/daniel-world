import {
  Matrix4,
  PerspectiveCamera,
  Triangle,
  Vector3,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
} from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { describe, expect, it } from 'vitest';
import { knifeLook, type KnifeSkin } from '@world/shared';
import { FINGERS, THUMB } from './hand.ts';
import { SWITCH, THROW, knifeMoves } from './knifeMoves.ts';
import { Viewmodel } from './viewmodel.ts';

/**
 * Checks that a knife never passes through the hand on screen, for the viewmodelClearance test
 * files, split by kind of knife so they run side by side. Each knife steps through its draw, idle,
 * inspect, a throw and its redraw, a switch to the fist and back, and every way one of those can be
 * cut short by another, and at each frame we measure how deep the knife, as drawn, reaches into the
 * hand, as skinned: the deepest any of the knife's material lies inside a phalanx or the palm, from
 * that part's surface.
 *
 * A grip solved round a circle between a handle's depth and its width leaves a handle that is not
 * round, and the bands and guards proud of it, pressing up to about 6 mm into the inside of the
 * fist, where the fingers wrapped round it hide it. That is each knife's floor, so the bounds are
 * against the knife's own grip at rest: never more than GRIP_ALLOWANCE deeper, and never deeper
 * than DEEPEST anywhere. Before the knife turned only on the finger, the deepest was 13 mm, through
 * the middle of the palm.
 */

/** How much deeper than its grip at rest a knife may reach into the hand, in meters. */
const GRIP_ALLOWANCE = 0.0025;
/** The deepest a knife may reach into the hand at all. */
const DEEPEST = 0.007;
const FRAME = 1 / 60;
/** Long enough after a knife is up for the hand to have closed on it. */
const SETTLE = 1;
/** How far apart the points over the knife's surface are, in the arm's units. */
const SPACING = 0.002;

const eye = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } };

interface Parts {
  scene: Object3D;
  arm: Object3D;
  model: Object3D;
  knifeHolder: Object3D;
  hand: { mesh: SkinnedMesh };
  shown: boolean;
}
const parts = (vm: Viewmodel): Parts => vm as unknown as Parts;

/** A point inside a part of the hand, in bind space, and how it is skinned. */
interface Core {
  readonly point: Vector3;
  readonly bones: readonly [number, number];
  readonly weights: readonly [number, number];
}

/** A part of the hand: a phalanx, rigid and convex, or the palm, which bends a little. */
interface Piece {
  readonly verts: readonly number[];
  readonly rigid: boolean;
  /** Face planes (normal, offset) this frame: the phalanx's own, or the palm's hull's. */
  planes: Float64Array;
  readonly center: Vector3;
  radius: number;
  /** Its middle: a phalanx's axis, or the palm's middle plane. */
  readonly core: readonly Core[];
  readonly coreNow: Vector3[];
}

/** A part of the knife, and points over its surface, bucketed into cells with bounding spheres. */
interface KnifePart {
  readonly mesh: Mesh;
  readonly tris: Float64Array;
  readonly cells: Float64Array;
  readonly samples: Float64Array;
  readonly cellStart: Int32Array;
  readonly min: Vector3;
  readonly max: Vector3;
  readonly toArm: Matrix4;
  readonly fromArm: Matrix4;
}

const RAYS = [
  new Vector3(0.5773, 0.5774, 0.5775).normalize(),
  new Vector3(-0.3, 0.8, -0.52).normalize(),
  new Vector3(0.71, -0.33, 0.62).normalize(),
];

/** Whether a point is inside closed triangles (9 numbers each), by the parity of three rays. */
function insideMesh(t: ArrayLike<number>, x: number, y: number, z: number): boolean {
  let votes = 0;
  for (const dir of RAYS) {
    let hits = 0;
    for (let k = 0; k < t.length; k += 9) {
      const e1x = t[k + 3]! - t[k]!;
      const e1y = t[k + 4]! - t[k + 1]!;
      const e1z = t[k + 5]! - t[k + 2]!;
      const e2x = t[k + 6]! - t[k]!;
      const e2y = t[k + 7]! - t[k + 1]!;
      const e2z = t[k + 8]! - t[k + 2]!;
      const px = dir.y * e2z - dir.z * e2y;
      const py = dir.z * e2x - dir.x * e2z;
      const pz = dir.x * e2y - dir.y * e2x;
      const det = e1x * px + e1y * py + e1z * pz;
      if (Math.abs(det) < 1e-16) continue;
      const sx = x - t[k]!;
      const sy = y - t[k + 1]!;
      const sz = z - t[k + 2]!;
      const u = (sx * px + sy * py + sz * pz) / det;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y;
      const qy = sz * e1x - sx * e1z;
      const qz = sx * e1y - sy * e1x;
      const v = (dir.x * qx + dir.y * qy + dir.z * qz) / det;
      if (v < 0 || u + v > 1) continue;
      if ((e2x * qx + e2y * qy + e2z * qz) / det > 0) hits++;
    }
    if (hits % 2 === 1) votes++;
  }
  return votes >= 2;
}

/** Points over a triangle every `step`: a square grid in its plane, and along its edges. */
function samplesOn(a: Vector3, b: Vector3, c: Vector3, step: number, out: number[]): void {
  for (const [p, q] of [
    [a, b],
    [b, c],
    [c, a],
  ] as const) {
    const n = Math.max(1, Math.ceil(p.distanceTo(q) / step));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      out.push(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t, p.z + (q.z - p.z) * t);
    }
  }
  const u = new Vector3().subVectors(b, a);
  const ab = u.length();
  if (ab < 1e-9) return;
  u.divideScalar(ab);
  const ac = new Vector3().subVectors(c, a);
  const w = ac.clone().addScaledVector(u, -ac.dot(u));
  const height = w.length();
  if (height < step / 2) return;
  w.divideScalar(height);
  const cu = ac.dot(u);
  for (let y = step / 2; y < height; y += step) {
    const k = y / height;
    const from = cu * k;
    const to = ab + (cu - ab) * k;
    for (let x = Math.min(from, to) + step / 2; x < Math.max(from, to); x += step) {
      out.push(a.x + u.x * x + w.x * y, a.y + u.y * x + w.y * y, a.z + u.z * x + w.z * y);
    }
  }
}

/**
 * Whether a bone is a phalanx: past the wrist, each finger's metacarpal and then its three, then
 * the thumb's three.
 */
const phalanx = (bone: number): boolean =>
  bone > FINGERS.length * 4 || (bone >= 1 && bone % 4 !== 1);

/** The hand's mesh as bound, split into its parts, the same for every view model. */
interface HandShape {
  readonly bind: Float64Array;
  readonly skinBones: Int32Array;
  readonly skinWeights: Float64Array;
  readonly pieces: readonly { verts: readonly number[]; rigid: boolean; core: readonly Core[] }[];
  readonly palmCorners: number;
}
let handShape: HandShape | null = null;

function shapeOf(mesh: SkinnedMesh): HandShape {
  if (handShape) return handShape;
  const geometry = mesh.geometry;
  const pos = geometry.getAttribute('position');
  const si = geometry.getAttribute('skinIndex');
  const sw = geometry.getAttribute('skinWeight');
  const n = pos.count;
  const bind = new Float64Array(n * 3);
  const skinBones = new Int32Array(n * 2);
  const skinWeights = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    bind.set([pos.getX(i), pos.getY(i), pos.getZ(i)], i * 3);
    skinBones.set([si.getX(i), si.getY(i)], i * 2);
    skinWeights.set([sw.getX(i), sw.getY(i)], i * 2);
  }
  // Every phalanx is skinned whole to its own bone; the rest of the hand is the palm.
  const verts = new Map<number, number[]>();
  for (let t = 0; t < n; t += 3) {
    const bone = phalanx(si.getX(t)) ? si.getX(t) : 0;
    if (!verts.has(bone)) verts.set(bone, []);
    verts.get(bone)!.push(t, t + 1, t + 2);
  }
  const cores = new Map<number, Core[]>([...verts.keys()].map((b) => [b, []]));
  // A phalanx's middle is its axis, joint to joint, every millimetre.
  const axis = (bone: number, base: readonly number[], from: number, length: number): void => {
    for (let s = 0; s <= length + 1e-9; s += 0.001) {
      cores.get(bone)!.push({
        point: new Vector3(base[0], base[1], base[2]! - from - s),
        bones: [bone, 0],
        weights: [1, 0],
      });
    }
  };
  FINGERS.forEach((finger, f) => {
    let from = 0;
    finger.lengths.forEach((length, j) => {
      axis(1 + f * 4 + 1 + j, finger.base, from, length);
      from += length;
    });
  });
  let from = 0;
  THUMB.lengths.forEach((length, j) => {
    axis(1 + FINGERS.length * 4 + j, THUMB.base, from, length);
    from += length;
  });
  // The palm's middle, every 2 mm, skinned as its nearest corner is.
  const palm = verts.get(0)!;
  const bindPalm = new Float64Array(palm.length * 3);
  palm.forEach((i, k) => bindPalm.set(bind.subarray(i * 3, i * 3 + 3), k * 3));
  const away = (i: number, y: number, z: number): number =>
    bind[i * 3]! ** 2 + (bind[i * 3 + 1]! - y) ** 2 + (bind[i * 3 + 2]! - z) ** 2;
  for (let y = -0.04; y <= 0.04; y += 0.002) {
    for (let z = -0.1; z <= 0.01; z += 0.002) {
      if (!insideMesh(bindPalm, 0, y, z)) continue;
      let nearest = palm[0]!;
      for (const i of palm) if (away(i, y, z) < away(nearest, y, z)) nearest = i;
      cores.get(0)!.push({
        point: new Vector3(0, y, z),
        bones: [skinBones[nearest * 2]!, skinBones[nearest * 2 + 1]!],
        weights: [skinWeights[nearest * 2]!, skinWeights[nearest * 2 + 1]!],
      });
    }
  }
  const pieces = [...verts].map(([bone, list]) => ({
    verts: list,
    rigid: bone !== 0,
    core: cores.get(bone)!,
  }));
  handShape = { bind, skinBones, skinWeights, pieces, palmCorners: palm.length };
  return handShape;
}

/** A knife part's triangles and the points over its surface, the same for every view model. */
type KnifeSurface = Pick<KnifePart, 'tris' | 'cells' | 'samples' | 'cellStart' | 'min' | 'max'>;
const surfaces = new WeakMap<object, KnifeSurface>();

function surfaceOf(mesh: Mesh): KnifeSurface {
  const geometry = mesh.geometry;
  const known = surfaces.get(geometry);
  if (known) return known;
  const p = geometry.getAttribute('position');
  const tris = new Float64Array(p.count * 3);
  for (let i = 0; i < p.count; i++) tris.set([p.getX(i), p.getY(i), p.getZ(i)], i * 3);
  // The knife is held at 0.78 of the arm.
  const step = SPACING / 0.78;
  const samples: number[] = [];
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let t = 0; t < tris.length; t += 9) {
    samplesOn(
      a.fromArray(tris, t),
      b.fromArray(tris, t + 3),
      c.fromArray(tris, t + 6),
      step,
      samples,
    );
  }
  // Bucketed into cells a few millimetres across, each culled by its own sphere.
  const cell = 0.006 / 0.78;
  const buckets = new Map<string, number[]>();
  for (let i = 0; i < samples.length; i += 3) {
    const key = [0, 1, 2].map((k) => Math.floor(samples[i + k]! / cell)).join();
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(samples[i]!, samples[i + 1]!, samples[i + 2]!);
  }
  const sorted: number[] = [];
  const cells: number[] = [];
  const cellStart: number[] = [];
  for (const list of buckets.values()) {
    cellStart.push(sorted.length / 3);
    const middle = new Vector3();
    for (let i = 0; i < list.length; i += 3) middle.add(a.fromArray(list, i));
    middle.divideScalar(list.length / 3);
    let r = 0;
    for (let i = 0; i < list.length; i += 3)
      r = Math.max(r, a.fromArray(list, i).distanceTo(middle));
    cells.push(middle.x, middle.y, middle.z, r);
    sorted.push(...list);
  }
  cellStart.push(sorted.length / 3);
  geometry.computeBoundingBox();
  const surface = {
    tris,
    cells: new Float64Array(cells),
    samples: new Float64Array(sorted),
    cellStart: Int32Array.from(cellStart),
    min: geometry.boundingBox!.min.clone(),
    max: geometry.boundingBox!.max.clone(),
  };
  surfaces.set(geometry, surface);
  return surface;
}

/**
 * How deep the knife in the view model reaches into its hand this frame, in the arm's units, for
 * what is in view of a 72 degree, 16:9 eye.
 */
class Clearance {
  private readonly vm: Viewmodel;
  private readonly mesh: SkinnedMesh;
  private readonly shape: HandShape;
  private readonly pieces: Piece[];
  private readonly knife: KnifePart[] = [];
  private readonly positions: Float64Array;
  private readonly boneMatrices: Matrix4[];
  private readonly palmTris: Float64Array;
  private readonly near: Piece[] = [];
  private readonly armInverse = new Matrix4();
  private readonly camera = new PerspectiveCamera(72, 16 / 9, 0.05, 200);
  private readonly v = new Vector3();
  private readonly w = new Vector3();
  private readonly triangle = new Triangle();
  private readonly closest = new Vector3();

  constructor(vm: Viewmodel) {
    this.vm = vm;
    this.mesh = parts(vm).hand.mesh;
    this.shape = shapeOf(this.mesh);
    this.positions = new Float64Array(this.shape.bind.length);
    this.boneMatrices = this.mesh.skeleton.bones.map(() => new Matrix4());
    this.palmTris = new Float64Array(this.shape.palmCorners * 3);
    this.pieces = this.shape.pieces.map(({ verts, rigid, core }) => ({
      verts,
      rigid,
      planes: new Float64Array((verts.length / 3) * 4),
      center: new Vector3(),
      radius: 0,
      core,
      coreNow: core.map(() => new Vector3()),
    }));
    parts(vm).model.traverse((o) => {
      const mesh = o as Mesh;
      if (!mesh.isMesh) return;
      this.knife.push({ mesh, ...surfaceOf(mesh), toArm: new Matrix4(), fromArm: new Matrix4() });
    });
  }

  /** A bind-space point skinned by two bones (from `at` in `bones` and `weights`), as GPUs skin. */
  private skin(
    x: number,
    y: number,
    z: number,
    bones: ArrayLike<number>,
    weights: ArrayLike<number>,
    at: number,
    out: Vector3,
  ): Vector3 {
    out.set(0, 0, 0);
    for (let k = at; k < at + 2; k++) {
      const weight = weights[k]!;
      if (weight === 0) continue;
      const e = this.boneMatrices[bones[k]!]!.elements;
      out.x += (e[0] * x + e[4] * y + e[8] * z + e[12]) * weight;
      out.y += (e[1] * x + e[5] * y + e[9] * z + e[13]) * weight;
      out.z += (e[2] * x + e[6] * y + e[10] * z + e[14]) * weight;
    }
    return out;
  }

  /**
   * How far inside a piece's planes a point is (0 or less outside): how deep it is in a phalanx;
   * no deeper than that in the palm, which lies within its hull. Stops once it is no deeper than
   * `floor`.
   */
  private depthIn(piece: Piece, x: number, y: number, z: number, floor: number): number {
    const planes = piece.planes;
    let depth = Infinity;
    for (let k = 0; k < planes.length; k += 4) {
      depth = Math.min(
        depth,
        planes[k + 3]! - (planes[k]! * x + planes[k + 1]! * y + planes[k + 2]! * z),
      );
      if (depth <= floor) return depth;
    }
    return depth;
  }

  /** How deep in the palm as drawn a point is: 0 outside. */
  private palmDepth(x: number, y: number, z: number): number {
    if (!insideMesh(this.palmTris, x, y, z)) return 0;
    const t = this.palmTris;
    const p = this.w.set(x, y, z);
    let depth = Infinity;
    for (let k = 0; k < t.length; k += 9) {
      this.triangle.a.fromArray(t, k);
      this.triangle.b.fromArray(t, k + 3);
      this.triangle.c.fromArray(t, k + 6);
      depth = Math.min(depth, this.triangle.closestPointToPoint(p, this.closest).distanceTo(p));
    }
    return depth;
  }

  private seen(x: number, y: number, z: number): boolean {
    const p = this.v.set(x, y, z).applyMatrix4(parts(this.vm).arm.matrixWorld).project(this.camera);
    return Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z > -1 && p.z < 1;
  }

  /** The deepest the knife reaches into the hand this frame, in the arm's units. */
  measure(): number {
    const vm = parts(this.vm);
    if (!vm.knifeHolder.visible || !vm.shown) return 0;
    vm.scene.updateMatrixWorld(true);
    this.armInverse.copy(vm.arm.matrixWorld).invert();
    const skeleton = this.mesh.skeleton;
    this.boneMatrices.forEach((m, b) =>
      m
        .multiplyMatrices(skeleton.bones[b]!.matrixWorld, skeleton.boneInverses[b]!)
        .premultiply(this.mesh.bindMatrixInverse)
        .multiply(this.mesh.bindMatrix),
    );
    const pos = this.positions;
    const { bind, skinBones, skinWeights } = this.shape;
    for (let i = 0; i < pos.length / 3; i++) {
      const [x, y, z] = [bind[i * 3]!, bind[i * 3 + 1]!, bind[i * 3 + 2]!];
      this.skin(x, y, z, skinBones, skinWeights, i * 2, this.v).toArray(pos, i * 3);
    }
    const a = new Vector3();
    const b = new Vector3();
    const c = new Vector3();
    for (const piece of this.pieces) {
      const verts = piece.verts;
      piece.center.set(0, 0, 0);
      for (const i of verts) piece.center.add(a.fromArray(pos, i * 3));
      piece.center.divideScalar(verts.length);
      piece.radius = 0;
      for (const i of verts)
        piece.radius = Math.max(piece.radius, a.fromArray(pos, i * 3).distanceTo(piece.center));
      if (piece.rigid) {
        for (let k = 0; k < verts.length; k += 3) {
          a.fromArray(pos, verts[k]! * 3);
          const normal = b
            .fromArray(pos, verts[k + 1]! * 3)
            .sub(a)
            .cross(c.fromArray(pos, verts[k + 2]! * 3).sub(a))
            .normalize();
          normal.toArray(piece.planes, (k / 3) * 4);
          piece.planes[(k / 3) * 4 + 3] = normal.dot(a);
        }
      } else {
        verts.forEach((i, k) => this.palmTris.set(pos.subarray(i * 3, i * 3 + 3), k * 3));
        const hull = new ConvexHull().setFromPoints(
          verts.map((i) => new Vector3().fromArray(pos, i * 3)),
        );
        piece.planes = new Float64Array(hull.faces.length * 4);
        hull.faces.forEach((face, k) => {
          face.normal.toArray(piece.planes, k * 4);
          piece.planes[k * 4 + 3] = face.constant;
        });
      }
      piece.core.forEach((core, i) =>
        this.skin(
          core.point.x,
          core.point.y,
          core.point.z,
          core.bones,
          core.weights,
          0,
          piece.coreNow[i]!,
        ),
      );
    }
    let deepest = 0;
    // Points of the palm are only bounded on the way, and worked out after, deepest bound first.
    const palm: { x: number; y: number; z: number; bound: number }[] = [];
    // The knife's surface inside the hand.
    for (const part of this.knife) {
      part.toArm.multiplyMatrices(this.armInverse, part.mesh.matrixWorld);
      part.fromArm.copy(part.toArm).invert();
      const e = part.toArm.elements;
      const scale = Math.hypot(e[0], e[1], e[2]);
      for (let t = 0; t < part.cells.length / 4; t++) {
        a.fromArray(part.cells, t * 4).applyMatrix4(part.toArm);
        const reach = part.cells[t * 4 + 3]! * scale;
        const near = this.near;
        near.length = 0;
        for (const piece of this.pieces) {
          if (a.distanceTo(piece.center) < reach + piece.radius) near.push(piece);
        }
        if (near.length === 0) continue;
        for (let s = part.cellStart[t]!; s < part.cellStart[t + 1]!; s++) {
          const [sx, sy, sz] = [
            part.samples[s * 3]!,
            part.samples[s * 3 + 1]!,
            part.samples[s * 3 + 2]!,
          ];
          const x = e[0] * sx + e[4] * sy + e[8] * sz + e[12];
          const y = e[1] * sx + e[5] * sy + e[9] * sz + e[13];
          const z = e[2] * sx + e[6] * sy + e[10] * sz + e[14];
          for (const piece of near) {
            const d = this.depthIn(piece, x, y, z, deepest);
            if (d <= deepest || !this.seen(x, y, z)) continue;
            if (piece.rigid) deepest = d;
            else palm.push({ x, y, z, bound: d });
          }
        }
      }
    }
    // The hand's middle inside the knife: a handle as thick as a finger, through it.
    for (const piece of this.pieces) {
      for (const p of piece.coreNow) {
        const d = this.depthIn(piece, p.x, p.y, p.z, deepest);
        if (d <= deepest) continue;
        const inKnife = this.knife.some((part) => {
          const q = this.w.copy(p).applyMatrix4(part.fromArm);
          if (q.x < part.min.x || q.y < part.min.y || q.z < part.min.z) return false;
          if (q.x > part.max.x || q.y > part.max.y || q.z > part.max.z) return false;
          return insideMesh(part.tris, q.x, q.y, q.z);
        });
        if (!inKnife || !this.seen(p.x, p.y, p.z)) continue;
        if (piece.rigid) deepest = d;
        else palm.push({ x: p.x, y: p.y, z: p.z, bound: d });
      }
    }
    palm.sort((p, q) => q.bound - p.bound);
    for (const p of palm) {
      if (p.bound <= deepest) break;
      deepest = Math.max(deepest, this.palmDepth(p.x, p.y, p.z));
    }
    return deepest;
  }
}

/** A view model holding a knife, and the deepest its knife reaches into the hand while measured. */
class Run {
  readonly vm = new Viewmodel();
  private readonly clearance: Clearance;
  private measuring = false;
  deepest = 0;
  where = '';
  private t = 0;

  constructor(skin: KnifeSkin) {
    this.vm.setLook(knifeLook(skin, undefined));
    this.clearance = new Clearance(this.vm);
  }

  play(seconds: number): this {
    for (let s = 0; s < seconds - 1e-9; s += FRAME) {
      this.vm.update(FRAME, eye as never, 0, 0, 0, true);
      this.t += FRAME;
      if (!this.measuring) continue;
      const depth = this.clearance.measure();
      if (depth > this.deepest) {
        this.deepest = depth;
        this.where = `${this.t.toFixed(3)} s in`;
      }
    }
    return this;
  }

  /** Measure from here on. */
  measure(): this {
    this.measuring = true;
    this.t = 0;
    return this;
  }

  /** Drawn and up, its flourish done. */
  up(skin: KnifeSkin): this {
    this.vm.setShown(true);
    return this.play(knifeMoves(skin).draw.duration + 0.3);
  }
}

/** Every move a knife makes, and every way they cut each other short. */
function scenarios(skin: KnifeSkin): [string, (run: Run) => void][] {
  const moves = knifeMoves(skin);
  const inspect = moves.inspect.duration;
  const draw = moves.draw.duration;
  const out: [string, (run: Run) => void][] = [
    ['drawn', (r) => (r.measure(), r.vm.setShown(true), r.play(draw + 0.3))],
    ['idling', (r) => r.up(skin).measure().play(Math.max(0.1, moves.idle.duration))],
    ['inspected', (r) => (r.up(skin).measure(), r.vm.startInspect(), r.play(inspect + 0.6))],
    ['thrown', (r) => (r.up(skin).measure(), r.vm.startThrow(), r.play(THROW.drawTo + 0.4))],
    [
      'switched to the fist and back',
      (r) => {
        r.up(skin).measure().vm.setArmed(false);
        r.play(0.6).vm.setArmed(true);
        r.play(SWITCH.lower + draw + 0.4);
      },
    ],
  ];
  for (const at of [0.03, 0.1, 0.22]) {
    out.push([
      `switched back ${at} s into a switch`,
      (r) => {
        r.up(skin).measure().vm.setArmed(false);
        r.play(at).vm.setArmed(true);
        r.play(SWITCH.lower + draw + 0.4);
      },
    ]);
  }
  for (let cut = 0.15; cut < inspect; cut += 0.35) {
    const cutShort = (then: (r: Run) => void, seconds: number) => (r: Run) => {
      r.up(skin).vm.startInspect();
      r.play(cut).measure();
      then(r);
      r.play(seconds);
    };
    const at = `${cut.toFixed(2)} s into its inspect`;
    out.push([`thrown ${at}`, cutShort((r) => r.vm.startThrow(), THROW.drawTo + 0.3)]);
    out.push([`inspected again ${at}`, cutShort((r) => r.vm.startInspect(), 0.8)]);
    out.push([`switched ${at}`, cutShort((r) => r.vm.setArmed(false), 0.4)]);
  }
  for (let cut = 0.03; cut < draw; cut += 0.12) {
    const fromDraw = (then: (r: Run) => void) => (r: Run) => {
      r.vm.setShown(true);
      r.play(cut).measure();
      then(r);
      r.play(0.8);
    };
    const at = `${cut.toFixed(2)} s into its draw`;
    out.push([`inspected ${at}`, fromDraw((r) => r.vm.startInspect())]);
    out.push([`thrown ${at}`, fromDraw((r) => r.vm.canThrow && r.vm.startThrow())]);
  }
  for (let cut = 0.5; cut < moves.idle.duration; cut += 1) {
    out.push([
      `inspected ${cut.toFixed(1)} s into its idle`,
      (r) => (r.up(skin).play(cut).measure(), r.vm.startInspect(), r.play(0.6)),
    ]);
  }
  return out;
}

/** How long checking one knife may take, on a machine busy with other tests. */
const CHECK_TIMEOUT = 60_000;

/** Every move and cut of each of `skins`, checked against its grip at rest. */
export function checkClearance(skins: readonly KnifeSkin[]): void {
  describe.each(skins.map((skin) => [skin]))('the %s in the hand on screen', (skin) => {
    it(
      'never passes through the hand, in any move or cut',
      () => {
        // The knife's own grip at rest, its floor: once the fingers have closed on the handle after
        // the draw, not while the last of them still are, or the floor would turn on the draw's timing.
        const rest = new Run(skin).up(skin).play(SETTLE).measure().play(FRAME).deepest;
        expect(rest).toBeLessThan(DEEPEST);
        for (const [name, play] of scenarios(skin)) {
          const run = new Run(skin);
          play(run);
          const mm = (m: number): string => `${(m * 1000).toFixed(1)} mm`;
          const deepest = `${mm(run.deepest)} in, ${run.where}, ${name} (its grip ${mm(rest)})`;
          expect(run.deepest, deepest).toBeLessThan(rest + GRIP_ALLOWANCE);
          expect(run.deepest, deepest).toBeLessThan(DEEPEST);
        }
      },
      CHECK_TIMEOUT,
    );
  });
}
