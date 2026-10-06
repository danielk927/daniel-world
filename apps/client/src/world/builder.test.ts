import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  SphereGeometry,
  Vector3,
  type Mesh,
} from 'three';
import { describe, expect, it } from 'vitest';
import { StaticBuilder, at } from './builder.ts';

describe('StaticBuilder', () => {
  it('merges each layer into one indexed mesh, keeping shared vertices shared', () => {
    const builder = new StaticBuilder().layer('a', new MeshBasicMaterial());
    const box = new BoxGeometry(1, 1, 1);
    builder.add('a', box, at(0, 0, 0)).add('a', box, at(5, 0, 0));
    const [mesh] = builder.build().children as Mesh[];
    const geometry = mesh!.geometry;
    expect(geometry.index).not.toBeNull();
    expect(geometry.getAttribute('position').count).toBe(box.getAttribute('position').count * 2);
    expect(geometry.index!.count).toBe(box.index!.count * 2);
  });

  it('normalizes attributes so any mix of geometries merges, and paints vertex colors', () => {
    const builder = new StaticBuilder().layer('painted', new MeshBasicMaterial(), {
      vertexColors: true,
    });
    // An unindexed triangle with no normals or UVs, next to an indexed sphere with all of them.
    const triangle = new BufferGeometry();
    triangle.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
    builder.add('painted', triangle, undefined, '#ff0000');
    builder.add('painted', new SphereGeometry(1, 6, 4), at(3, 0, 0), '#0000ff');
    const [mesh] = builder.build().children as Mesh[];
    const g = mesh!.geometry;
    expect(Object.keys(g.attributes).sort()).toEqual(['color', 'normal', 'position', 'uv']);
    const color = g.getAttribute('color');
    expect([color.getX(0), color.getY(0), color.getZ(0)]).toEqual([1, 0, 0]);
    const last = color.count - 1;
    expect([color.getX(last), color.getY(last), color.getZ(last)]).toEqual([0, 0, 1]);
  });

  it('skips empty layers and marks meshes static', () => {
    const builder = new StaticBuilder()
      .layer('empty', new MeshBasicMaterial())
      .layer('full', new MeshBasicMaterial(), { castShadow: true });
    builder.add('full', new BoxGeometry(1, 1, 1));
    const children = builder.build().children as Mesh[];
    expect(children.map((c) => c.name)).toEqual(['full']);
    expect(children[0]!.castShadow).toBe(true);
    expect(children[0]!.matrixAutoUpdate).toBe(false);
  });

  it('keeps faces pointing outward when a transform mirrors the geometry', () => {
    // A negative scale on one axis (a box given its extents in reverse, say) flips the winding; if
    // nothing flips it back, the GPU culls the outside and draws the inside of the box.
    const builder = new StaticBuilder().layer('a', new MeshBasicMaterial());
    builder.add('a', new BoxGeometry(1, 1, 1), at(0, 0, 0, { sz: -2 }));
    const [mesh] = builder.build().children as Mesh[];
    const position = mesh!.geometry.getAttribute('position');
    const index = mesh!.geometry.index!;
    const [a, b, c, normal, centroid] = [
      new Vector3(),
      new Vector3(),
      new Vector3(),
      new Vector3(),
      new Vector3(),
    ];
    for (let i = 0; i < index.count; i += 3) {
      a.fromBufferAttribute(position, index.getX(i));
      b.fromBufferAttribute(position, index.getX(i + 1));
      c.fromBufferAttribute(position, index.getX(i + 2));
      normal.subVectors(b, a).cross(c.clone().sub(a));
      centroid.copy(a).add(b).add(c).divideScalar(3);
      // The box is centered on the origin, so an outward face points away from it.
      expect(normal.dot(centroid)).toBeGreaterThan(0);
    }
  });

  it('keeps a geometry its own vertex colors unless the caller paints over them', () => {
    const builder = new StaticBuilder().layer('painted', new MeshBasicMaterial(), {
      vertexColors: true,
    });
    const triangle = () => {
      const g = new BufferGeometry();
      g.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
      g.setAttribute('color', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1], 3));
      return g;
    };
    builder.add('painted', triangle());
    builder.add('painted', triangle(), undefined, '#ffffff');
    const [mesh] = builder.build().children as Mesh[];
    const color = mesh!.geometry.getAttribute('color');
    expect(Array.from({ length: 6 }, (_, i) => color.getY(i))).toEqual([0, 1, 0, 1, 1, 1]);
  });

  it('refuses unknown layers', () => {
    expect(() => new StaticBuilder().add('nope', new BoxGeometry())).toThrow(/Unknown layer/);
  });
});
