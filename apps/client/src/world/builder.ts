import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Euler,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface LayerOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
  /** Write a per-vertex color for every part, so one material can paint many objects. */
  readonly vertexColors?: boolean;
  /**
   * Write a per-vertex finish for every part (the `finish` attribute, 1 by default): a roughness
   * multiplier, so one material can be glossy on one part and dull on the next.
   */
  readonly finish?: boolean;
  /** Draw order among meshes, for transparent layers that overlap (lower draws first). */
  readonly renderOrder?: number;
  /**
   * Its parts' texture coordinates: in meters (the default), or for a layer of pictures (a sign),
   * the geometry's own, so the picture lies across each part from edge to edge.
   */
  readonly uv?: 'project' | 'own';
}

/** How one part is added, beyond its geometry, transform and paint. */
export interface PartOptions {
  /** Its roughness multiplier, on a layer with a finish. */
  readonly finish?: number;
  /**
   * Its texture coordinates, in meters: projected along each face's normal (the default, for
   * anything flat-faced), or the geometry's own, which its maker has already put in meters (round
   * things, unrolled to their circumference).
   */
  readonly uv?: 'project' | 'own';
}

interface Layer {
  readonly material: Material;
  readonly options: LayerOptions;
  readonly parts: BufferGeometry[];
}

const euler = new Euler();
const quaternion = new Quaternion();
const position = new Vector3();
const scale = new Vector3();
const local = new Vector3();
const partPosition = new Vector3();
const partRotation = new Quaternion();
const partScale = new Vector3();
const face = new Vector3();
const edgeA = new Vector3();
const edgeB = new Vector3();

/**
 * Texture coordinates in meters for a part, projected along each face's normal: a face looking up or
 * down maps its horizontal plane, with u along the part's longer horizontal side (so grain runs
 * along a board); a wall-like face maps its horizontal run as u and height as v. Measured in the
 * part's own frame, scaled to size, and offset by where it stands, so parts that are not turned land
 * on one grid in world space (floor and wall tiles line up across parts).
 */
function projectUvs(part: BufferGeometry, matrix: Matrix4 | undefined, indexed: boolean): void {
  const positions = part.getAttribute('position');
  const normals = part.getAttribute('normal');
  const count = positions.count;
  const offset = partPosition.set(0, 0, 0);
  const scale = partScale.set(1, 1, 1);
  if (matrix) matrix.decompose(offset, partRotation, scale);
  part.computeBoundingBox();
  const size = part.boundingBox!.getSize(local);
  const grainAlongZ = Math.abs(size.z * scale.z) > Math.abs(size.x * scale.x);
  const uvs = new Float32Array(count * 2);
  const index = part.index;
  const place = (v: number, nx: number, ny: number, nz: number): void => {
    const x = positions.getX(v) * scale.x + offset.x;
    const y = positions.getY(v) * scale.y + offset.y;
    const z = positions.getZ(v) * scale.z + offset.z;
    const ax = Math.abs(nx);
    const ay = Math.abs(ny);
    const az = Math.abs(nz);
    let u: number;
    let w: number;
    if (ay >= ax && ay >= az) [u, w] = grainAlongZ ? [z, x] : [x, z];
    else if (ax >= az) [u, w] = [z, y];
    else [u, w] = [x, y];
    uvs[v * 2] = u;
    uvs[v * 2 + 1] = w;
  };
  if (indexed || !index) {
    // Shared vertices: each by its own normal (a box's faces have their own vertices).
    for (let v = 0; v < count; v++) {
      // Normals scale inversely to the shape.
      place(
        v,
        normals.getX(v) / (scale.x || 1),
        normals.getY(v) / (scale.y || 1),
        normals.getZ(v) / (scale.z || 1),
      );
    }
  } else {
    // Triangles of their own: each by its face's normal, so a triangle is never torn in two.
    for (let i = 0; i < index.count; i += 3) {
      const a = index.getX(i);
      const b = index.getX(i + 1);
      const c = index.getX(i + 2);
      edgeA.fromBufferAttribute(positions, b).sub(face.fromBufferAttribute(positions, a));
      edgeB.fromBufferAttribute(positions, c).sub(face);
      edgeA.multiply(scale);
      edgeB.multiply(scale);
      face.crossVectors(edgeA, edgeB);
      for (const v of [a, b, c]) place(v, face.x, face.y, face.z);
    }
  }
  part.setAttribute('uv', new BufferAttribute(uvs, 2));
}

/** A transform for a part: position, yaw (and optional pitch and roll), and scale. */
export function at(
  x: number,
  y: number,
  z: number,
  options: { ry?: number; rx?: number; rz?: number; sx?: number; sy?: number; sz?: number } = {},
): Matrix4 {
  euler.set(options.rx ?? 0, options.ry ?? 0, options.rz ?? 0, 'YXZ');
  quaternion.setFromEuler(euler);
  position.set(x, y, z);
  scale.set(options.sx ?? 1, options.sy ?? 1, options.sz ?? 1);
  return new Matrix4().compose(position, quaternion, scale);
}

/**
 * Collects static geometry and merges it into one mesh per material, so the whole kitchen costs a
 * handful of draw calls no matter how many pots and knobs it has. Construction time only.
 */
export class StaticBuilder {
  private readonly layers = new Map<string, Layer>();

  layer(name: string, material: Material, options: LayerOptions = {}): this {
    this.layers.set(name, { material, options, parts: [] });
    return this;
  }

  /** Add a transformed copy of `geometry` to a layer. `color` paints it on vertex-colored layers. */
  add(
    name: string,
    geometry: BufferGeometry,
    matrix?: Matrix4,
    color?: Color | string,
    options: PartOptions = {},
  ): this {
    const layer = this.layers.get(name);
    if (!layer) throw new Error(`Unknown layer ${name}`);
    // Every part gets the same attribute set and an index, so any mix of three.js geometries can be
    // merged while shared vertices stay shared (a third of the vertex work of unindexed triangles).
    // A plain copy: cloning one of three.js's shapes first builds a default one of its own.
    const part = new BufferGeometry().copy(geometry);
    const indexed = part.index !== null;
    if (!part.index) {
      const vertices = part.getAttribute('position').count;
      const order = vertices > 65535 ? new Uint32Array(vertices) : new Uint16Array(vertices);
      for (let i = 0; i < vertices; i++) order[i] = i;
      part.setIndex(new BufferAttribute(order, 1));
    }
    // Geometry that brings its own vertex colors keeps them, unless the caller paints over them.
    const ownColors =
      layer.options.vertexColors && color === undefined && 'color' in part.attributes;
    if (ownColors) {
      const own = part.getAttribute('color');
      // Merged with the RGB floats painted for every other part, so it must be the same kind.
      if (own.itemSize !== 3 || !(own.array instanceof Float32Array) || own.normalized) {
        throw new Error(`Layer ${name} needs vertex colors as RGB floats`);
      }
    }
    for (const attribute of Object.keys(part.attributes)) {
      if (attribute === 'color' && ownColors) continue;
      if (attribute !== 'position' && attribute !== 'normal' && attribute !== 'uv') {
        part.deleteAttribute(attribute);
      }
    }
    const count = part.getAttribute('position').count;
    if (!part.getAttribute('normal')) part.computeVertexNormals();
    const uv = options.uv ?? layer.options.uv;
    if (uv !== 'own' || !part.getAttribute('uv')) projectUvs(part, matrix, indexed);
    if (layer.options.finish) {
      part.setAttribute(
        'finish',
        new BufferAttribute(new Float32Array(count).fill(options.finish ?? 1), 1),
      );
    }
    if (layer.options.vertexColors && !ownColors) {
      const c = color instanceof Color ? color : new Color(color ?? '#ffffff');
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
      }
      part.setAttribute('color', new BufferAttribute(colors, 3));
    }
    part.morphAttributes = {};
    part.clearGroups();
    if (matrix) {
      part.applyMatrix4(matrix);
      // A mirroring transform (a negative scale) reverses the winding, which would turn the part
      // inside out: the GPU culls its outside and draws its inside, fighting anything it rests on.
      if (matrix.determinant() < 0) {
        const index = part.index!;
        for (let i = 0; i < index.count; i += 3) {
          const second = index.getX(i + 1);
          index.setX(i + 1, index.getX(i + 2));
          index.setX(i + 2, second);
        }
      }
    }
    layer.parts.push(part);
    return this;
  }

  /** One mesh per non-empty layer. */
  build(): Group {
    const group = new Group();
    for (const [name, layer] of this.layers) {
      if (layer.parts.length === 0) continue;
      const geometry = mergeGeometries(layer.parts, false);
      if (!geometry) throw new Error(`Could not merge layer ${name}`);
      geometry.computeBoundingSphere();
      for (const part of layer.parts) part.dispose();
      const mesh = new Mesh(geometry, layer.material);
      mesh.name = name;
      mesh.castShadow = layer.options.castShadow ?? false;
      mesh.receiveShadow = layer.options.receiveShadow ?? true;
      mesh.renderOrder = layer.options.renderOrder ?? 0;
      // Everything is static: compute the matrix once and never again.
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      group.add(mesh);
    }
    return group;
  }
}
