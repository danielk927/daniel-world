import {
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  MeshBasicMaterial,
  SphereGeometry,
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

  it('refuses unknown layers', () => {
    expect(() => new StaticBuilder().add('nope', new BoxGeometry())).toThrow(/Unknown layer/);
  });
});
