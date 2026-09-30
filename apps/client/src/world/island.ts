import {
  BoxGeometry,
  BufferGeometry,
  Color,
  DodecahedronGeometry,
  Float32BufferAttribute,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
} from 'three';
import { ISLAND_RADIUS, createRandom, terrainHeight } from '@world/shared';

const tmpColor = new Color();

/** Accumulates flat-shaded triangles with one color per face (the low-poly look). */
class FacetBuilder {
  private readonly positions: number[] = [];
  private readonly colors: number[] = [];

  triangle(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    cx: number,
    cy: number,
    cz: number,
    color: Color,
  ): void {
    this.positions.push(ax, ay, az, bx, by, bz, cx, cy, cz);
    for (let i = 0; i < 3; i++) this.colors.push(color.r, color.g, color.b);
  }

  build(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new Float32BufferAttribute(this.colors, 3));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

const GRASS = ['#8dbd5b', '#80b453', '#98c763', '#76aa4d', '#a3c865'].map((c) => new Color(c));
const HILLTOP = new Color('#c2cf6a');
const DIRT = new Color('#b0845a');

/**
 * The grass top: a triangle lattice clipped to a circle, with each vertex lifted to the shared
 * terrain height so rendering matches collision exactly.
 */
function createTerrain(): Mesh {
  const random = createRandom(11);
  const spacing = 1.15;
  const rowHeight = spacing * Math.sqrt(3) * 0.5;
  const extent = ISLAND_RADIUS + spacing;
  const rows = Math.ceil((extent * 2) / rowHeight) + 1;
  const cols = Math.ceil((extent * 2) / spacing) + 2;

  // Lattice points; anything outside the island is pulled onto the rim circle.
  const px: number[] = [];
  const pz: number[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let x = -extent + col * spacing + (row % 2 === 1 ? spacing / 2 : 0);
      let z = -extent + row * rowHeight;
      // A little jitter keeps the lattice from reading as a grid.
      const r = Math.hypot(x, z);
      if (r < ISLAND_RADIUS - 0.8 && r > 0.5) {
        x += (random() - 0.5) * spacing * 0.35;
        z += (random() - 0.5) * spacing * 0.35;
      }
      const clamped = Math.hypot(x, z);
      if (clamped > ISLAND_RADIUS) {
        x = (x / clamped) * ISLAND_RADIUS;
        z = (z / clamped) * ISLAND_RADIUS;
      }
      px.push(x);
      pz.push(z);
    }
  }

  const builder = new FacetBuilder();
  const index = (row: number, col: number): number => row * cols + col;
  const addTriangle = (a: number, b: number, c: number): void => {
    const ax = px[a]!;
    const az = pz[a]!;
    const bx = px[b]!;
    const bz = pz[b]!;
    const cx = px[c]!;
    const cz = pz[c]!;
    const centerX = (ax + bx + cx) / 3;
    const centerZ = (az + bz + cz) / 3;
    const centerR = Math.hypot(centerX, centerZ);
    if (centerR > ISLAND_RADIUS - 0.05) return;
    // Degenerate slivers where several points collapsed onto the rim.
    const area = Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az));
    if (area < 1e-4) return;

    const ay = terrainHeight(ax, az);
    const by = terrainHeight(bx, bz);
    const cy = terrainHeight(cx, cz);
    const height = (ay + by + cy) / 3;
    tmpColor.copy(GRASS[Math.floor(random() * GRASS.length)]!);
    tmpColor.lerp(HILLTOP, Math.min(1, Math.max(0, (height - 1.3) * 0.6)) * 0.55);
    if (centerR > ISLAND_RADIUS - 1.6) tmpColor.lerp(DIRT, 0.75);
    tmpColor.offsetHSL(0, 0, (random() - 0.5) * 0.03);
    // Counter-clockwise when seen from above, so faces point up.
    builder.triangle(ax, ay, az, cx, cy, cz, bx, by, bz, tmpColor);
  };

  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      if (row % 2 === 0) {
        addTriangle(index(row, col), index(row, col + 1), index(row + 1, col));
        addTriangle(index(row, col + 1), index(row + 1, col + 1), index(row + 1, col));
      } else {
        addTriangle(index(row, col), index(row + 1, col + 1), index(row + 1, col));
        addTriangle(index(row, col), index(row, col + 1), index(row + 1, col + 1));
      }
    }
  }

  const mesh = new Mesh(
    builder.build(),
    new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }),
  );
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}

const STRATA = ['#9a6b45', '#a57d68', '#8f7482', '#77667f', '#5f5570', '#4b4560'].map(
  (c) => new Color(c),
);

/** Rocky underside: a jagged inverted cone with colored strata. */
function createCliff(): Mesh {
  const random = createRandom(23);
  const rimY = terrainHeight(ISLAND_RADIUS, 0);
  // Radius and height of each ring from the rim down to the tip.
  const profile: [number, number][] = [
    [ISLAND_RADIUS, rimY],
    [ISLAND_RADIUS + 0.35, rimY - 0.7],
    [ISLAND_RADIUS - 0.4, rimY - 2.6],
    [ISLAND_RADIUS - 3, rimY - 5],
    [ISLAND_RADIUS - 8, rimY - 8.5],
    [ISLAND_RADIUS - 14, rimY - 12.5],
    [ISLAND_RADIUS - 21, rimY - 17],
    [ISLAND_RADIUS - 28, rimY - 22],
    [ISLAND_RADIUS - 33.5, rimY - 27],
    [0, rimY - 31],
  ];
  const segments = 96;
  const ringX: number[][] = [];
  const ringY: number[][] = [];
  const ringZ: number[][] = [];
  profile.forEach(([radius, y], ring) => {
    const xs: number[] = [];
    const ys: number[] = [];
    const zs: number[] = [];
    for (let s = 0; s < segments; s++) {
      const angle = (s / segments) * Math.PI * 2;
      // The top ring stays exact so it meets the grass edge without a seam.
      const wobble = ring === 0 ? 0 : (random() - 0.5) * 2.2 * Math.min(1, radius / 8);
      const drop = ring === 0 ? 0 : (random() - 0.5) * 1.2;
      const r = Math.max(0, radius + wobble);
      xs.push(Math.sin(angle) * r);
      ys.push(y + drop);
      zs.push(-Math.cos(angle) * r);
    }
    ringX.push(xs);
    ringY.push(ys);
    ringZ.push(zs);
  });

  const builder = new FacetBuilder();
  for (let ring = 0; ring < profile.length - 1; ring++) {
    const band =
      STRATA[
        Math.min(STRATA.length - 1, Math.floor((ring / (profile.length - 1)) * STRATA.length))
      ]!;
    for (let s = 0; s < segments; s++) {
      const n = (s + 1) % segments;
      const a = [ringX[ring]![s]!, ringY[ring]![s]!, ringZ[ring]![s]!] as const;
      const b = [ringX[ring]![n]!, ringY[ring]![n]!, ringZ[ring]![n]!] as const;
      const c = [ringX[ring + 1]![s]!, ringY[ring + 1]![s]!, ringZ[ring + 1]![s]!] as const;
      const d = [ringX[ring + 1]![n]!, ringY[ring + 1]![n]!, ringZ[ring + 1]![n]!] as const;
      tmpColor.copy(band).offsetHSL(0, 0, (random() - 0.5) * 0.06);
      builder.triangle(...a, ...b, ...c, tmpColor);
      tmpColor.copy(band).offsetHSL(0, 0, (random() - 0.5) * 0.06);
      builder.triangle(...b, ...d, ...c, tmpColor);
    }
  }
  const mesh = new Mesh(
    builder.build(),
    new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }),
  );
  mesh.name = 'cliff';
  return mesh;
}

/** Low stone wall around the rim, with lanterns. Makes the play boundary obvious. */
function createRimWall(): Group {
  const random = createRandom(31);
  const group = new Group();
  const radius = ISLAND_RADIUS - 0.95;
  const blockCount = 120;
  const lanternEvery = 10;
  const dummy = new Object3D();
  const color = new Color();

  const blocks = new InstancedMesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
    blockCount,
  );
  const lanternCount = blockCount / lanternEvery;
  const posts = new InstancedMesh(
    new BoxGeometry(0.16, 1, 0.16),
    new MeshStandardMaterial({ color: '#5b4636', roughness: 0.8 }),
    lanternCount,
  );
  const lamps = new InstancedMesh(
    new BoxGeometry(0.34, 0.4, 0.34),
    new MeshStandardMaterial({
      color: '#ffe0a3',
      emissive: '#ffb257',
      emissiveIntensity: 2.2,
      roughness: 0.4,
    }),
    lanternCount,
  );

  for (let i = 0; i < blockCount; i++) {
    const angle = (i / blockCount) * Math.PI * 2 + (random() - 0.5) * 0.01;
    const x = Math.sin(angle) * radius;
    const z = -Math.cos(angle) * radius;
    const height = 0.55 + random() * 0.3;
    dummy.position.set(x, terrainHeight(x, z) + height / 2 - 0.12, z);
    dummy.rotation.set(
      (random() - 0.5) * 0.08,
      -angle + (random() - 0.5) * 0.12,
      (random() - 0.5) * 0.08,
    );
    dummy.scale.set(((Math.PI * 2 * radius) / blockCount) * 0.93, height, 0.62 + random() * 0.1);
    dummy.updateMatrix();
    blocks.setMatrixAt(i, dummy.matrix);
    color.set('#cbbba6').offsetHSL((random() - 0.5) * 0.03, 0, (random() - 0.5) * 0.12);
    blocks.setColorAt(i, color);

    if (i % lanternEvery === 0) {
      const slot = i / lanternEvery;
      const y = terrainHeight(x, z) + height - 0.12;
      dummy.rotation.set(0, -angle, 0);
      dummy.scale.set(1, 1, 1);
      dummy.position.set(x, y + 0.5, z);
      dummy.updateMatrix();
      posts.setMatrixAt(slot, dummy.matrix);
      dummy.position.set(x, y + 1.15, z);
      dummy.updateMatrix();
      lamps.setMatrixAt(slot, dummy.matrix);
    }
  }
  blocks.castShadow = true;
  blocks.receiveShadow = true;
  posts.castShadow = true;
  group.add(blocks, posts, lamps);
  group.name = 'rim-wall';
  return group;
}

/** Chunks of rock drifting below the island. */
function createDebris(): InstancedMesh {
  const random = createRandom(41);
  const count = 26;
  const mesh = new InstancedMesh(
    new DodecahedronGeometry(1, 0),
    new MeshStandardMaterial({ color: '#7d6a7d', flatShading: true, roughness: 1 }),
    count,
  );
  const matrix = new Matrix4();
  const dummy = new Object3D();
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    const r = ISLAND_RADIUS + 4 + random() * 22;
    const size = 0.6 + random() * 2.2;
    dummy.position.set(Math.sin(angle) * r, -4 - random() * 18, -Math.cos(angle) * r);
    dummy.rotation.set(random() * 3, random() * 3, random() * 3);
    dummy.scale.set(size, size * (0.6 + random() * 0.6), size * (0.7 + random() * 0.5));
    dummy.updateMatrix();
    matrix.copy(dummy.matrix);
    mesh.setMatrixAt(i, matrix);
  }
  mesh.name = 'debris';
  return mesh;
}

export interface Island {
  readonly group: Group;
  /** Slowly turns the floating debris. */
  update(dt: number): void;
}

export function createIsland(): Island {
  const group = new Group();
  const debris = createDebris();
  group.add(createTerrain(), createCliff(), createRimWall(), debris);
  return {
    group,
    update(dt) {
      debris.rotation.y += dt * 0.01;
    },
  };
}
