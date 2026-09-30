import {
  type BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  Mesh,
  Matrix4,
  MeshStandardMaterial,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createRandom } from '@world/shared';

function colored(geometry: BufferGeometry, hex: string, matrix: Matrix4): BufferGeometry {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  g.applyMatrix4(matrix);
  const color = new Color(hex);
  const colors = new Float32Array(g.getAttribute('position').count * 3);
  for (let i = 0; i < colors.length; i += 3) {
    colors[i] = color.r;
    colors[i + 1] = color.g;
    colors[i + 2] = color.b;
  }
  g.setAttribute('color', new Float32BufferAttribute(colors, 3));
  g.deleteAttribute('uv');
  return g;
}

/** Far-off floating islands, merged into a single draw call. Fog does the rest. */
export function createDistantIslands(): Mesh {
  const random = createRandom(3);
  const parts: BufferGeometry[] = [];
  const m = new Matrix4();
  const flip = new Matrix4().makeRotationX(Math.PI);
  const count = 9;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + random() * 0.5;
    const distance = 150 + random() * 170;
    const x = Math.sin(angle) * distance;
    const z = -Math.cos(angle) * distance;
    const y = -18 + random() * 38;
    const size = 6 + random() * 12;

    m.makeScale(size, size * 0.18, size).setPosition(x, y, z);
    parts.push(colored(new CylinderGeometry(1, 0.92, 1, 9), '#86b85a', m));
    m.makeScale(size * 0.95, size * 1.4, size * 0.95).setPosition(x, y - size * 0.78, z);
    m.multiply(flip);
    parts.push(colored(new ConeGeometry(1, 1, 9), '#8a7384', m));
    const trees = 1 + Math.floor(random() * 3);
    for (let t = 0; t < trees; t++) {
      const tx = x + (random() - 0.5) * size;
      const tz = z + (random() - 0.5) * size;
      const ts = size * (0.12 + random() * 0.1);
      m.makeScale(ts, ts * 1.1, ts).setPosition(tx, y + ts * 1.4, tz);
      parts.push(colored(new IcosahedronGeometry(1, 0), random() < 0.3 ? '#f2a6c4' : '#5f9f44', m));
    }
  }
  const geometry = mergeGeometries(parts);
  geometry.computeVertexNormals();
  const mesh = new Mesh(
    geometry,
    new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }),
  );
  mesh.name = 'distant-islands';
  return mesh;
}
