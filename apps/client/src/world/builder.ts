import {
  BufferAttribute,
  Color,
  Euler,
  Group,
  Matrix4,
  Mesh,
  Quaternion,
  Vector3,
  type BufferGeometry,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export interface LayerOptions {
  readonly castShadow?: boolean;
  readonly receiveShadow?: boolean;
  /** Write a per-vertex color for every part, so one material can paint many objects. */
  readonly vertexColors?: boolean;
  /** Draw order among meshes, for transparent layers that overlap (lower draws first). */
  readonly renderOrder?: number;
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
  add(name: string, geometry: BufferGeometry, matrix?: Matrix4, color?: Color | string): this {
    const layer = this.layers.get(name);
    if (!layer) throw new Error(`Unknown layer ${name}`);
    // Every part gets the same attribute set and an index, so any mix of three.js geometries can be
    // merged while shared vertices stay shared (a third of the vertex work of unindexed triangles).
    const part = geometry.clone();
    if (!part.index) {
      const vertices = part.getAttribute('position').count;
      part.setIndex(Array.from({ length: vertices }, (_, i) => i));
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
    if (!part.getAttribute('uv')) {
      part.setAttribute('uv', new BufferAttribute(new Float32Array(count * 2), 2));
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
