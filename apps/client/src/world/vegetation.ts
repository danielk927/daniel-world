import {
  BufferGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  MeshStandardMaterial,
  Object3D,
  Vector3,
} from 'three';
import {
  COLLIDERS,
  PLAZA_RADIUS,
  PLAY_RADIUS,
  ROCKS,
  TREES,
  createRandom,
  terrainHeight,
  type TreeSpot,
} from '@world/shared';
import { addWindSway } from './wind.ts';

const dummy = new Object3D();
const color = new Color();
const offset = new Vector3();

const LEAF_COLORS = {
  round: ['#6fae4b', '#5f9f44', '#86bd57', '#79b24f'],
  blossom: ['#f5a3c7', '#f7b8d2', '#ee8fb5', '#f9c6dc'],
  pine: ['#3f7f55', '#4a8a5c', '#3a7550'],
} as const;

/** Foliage blobs relative to the trunk base: x, y, z, radius. */
const BLOBS: readonly (readonly [number, number, number, number])[] = [
  [0, 2.75, 0, 1.25],
  [0.62, 2.25, 0.25, 0.88],
  [-0.5, 2.4, -0.4, 0.85],
];

/** Pine tiers: y, radius, height. */
const TIERS: readonly (readonly [number, number, number])[] = [
  [1.55, 1.3, 1.7],
  [2.45, 1.0, 1.5],
  [3.25, 0.68, 1.25],
];

function placeRelative(tree: TreeSpot, x: number, y: number, z: number, scale: number): void {
  offset.set(x, y, z).applyAxisAngle(Object3D.DEFAULT_UP, tree.rotation).multiplyScalar(tree.scale);
  dummy.position.set(tree.x + offset.x, tree.y + offset.y, tree.z + offset.z);
  dummy.rotation.set(0, tree.rotation, 0);
  dummy.scale.setScalar(scale * tree.scale);
  dummy.updateMatrix();
}

function createTrees(random: () => number): Group {
  const group = new Group();
  const roundTrees = TREES.filter((t) => t.kind !== 'pine');
  const pines = TREES.filter((t) => t.kind === 'pine');

  const trunkGeometry = new CylinderGeometry(0.16, 0.27, 2.4, 6);
  trunkGeometry.translate(0, 1.2, 0);
  const trunks = new InstancedMesh(
    trunkGeometry,
    new MeshStandardMaterial({ roughness: 0.9, flatShading: true }),
    TREES.length,
  );
  TREES.forEach((tree, i) => {
    dummy.position.set(tree.x, tree.y - 0.1, tree.z);
    dummy.rotation.set(0, tree.rotation, 0);
    dummy.scale.set(tree.scale, tree.scale * (tree.kind === 'pine' ? 0.75 : 1), tree.scale);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    color.set('#7a5638').offsetHSL(0, 0, (random() - 0.5) * 0.08);
    trunks.setColorAt(i, color);
  });

  const leafMaterial = new MeshStandardMaterial({ roughness: 0.8, flatShading: true });
  addWindSway(leafMaterial, 0.05, 0.35);
  const blobs = new InstancedMesh(
    new IcosahedronGeometry(1, 1),
    leafMaterial,
    roundTrees.length * BLOBS.length,
  );
  let b = 0;
  for (const tree of roundTrees) {
    const colors = LEAF_COLORS[tree.kind === 'blossom' ? 'blossom' : 'round'];
    for (const [x, y, z, r] of BLOBS) {
      placeRelative(tree, x, y, z, r);
      blobs.setMatrixAt(b, dummy.matrix);
      color.set(colors[Math.floor(random() * colors.length)]!);
      blobs.setColorAt(b, color);
      b++;
    }
  }

  const pineMaterial = new MeshStandardMaterial({ roughness: 0.85, flatShading: true });
  addWindSway(pineMaterial, 0.04, 0.4);
  const cones = new InstancedMesh(
    new ConeGeometry(1, 1, 7),
    pineMaterial,
    Math.max(1, pines.length * TIERS.length),
  );
  cones.count = pines.length * TIERS.length;
  let c = 0;
  for (const tree of pines) {
    const tint = LEAF_COLORS.pine[Math.floor(random() * LEAF_COLORS.pine.length)]!;
    for (const [y, r, h] of TIERS) {
      offset.set(0, y, 0).multiplyScalar(tree.scale);
      dummy.position.set(tree.x, tree.y + offset.y, tree.z);
      dummy.rotation.set(0, tree.rotation + c, 0);
      dummy.scale.set(r * tree.scale, h * tree.scale, r * tree.scale);
      dummy.updateMatrix();
      cones.setMatrixAt(c, dummy.matrix);
      color.set(tint).offsetHSL(0, 0, (random() - 0.5) * 0.05);
      cones.setColorAt(c, color);
      c++;
    }
  }

  for (const mesh of [trunks, blobs, cones]) {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  }
  group.add(trunks, blobs, cones);
  group.name = 'trees';
  return group;
}

function createRocks(random: () => number): InstancedMesh {
  const rocks = new InstancedMesh(
    new DodecahedronGeometry(1, 0),
    new MeshStandardMaterial({ roughness: 0.95, flatShading: true }),
    ROCKS.length,
  );
  ROCKS.forEach((rock, i) => {
    const s = rock.scale;
    dummy.position.set(rock.x, rock.y + 0.2 * s, rock.z);
    dummy.rotation.set(random() * 0.5, rock.rotation, random() * 0.5);
    dummy.scale.set(0.95 * s, 0.75 * s, 0.85 * s);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    color.set('#a3959c').offsetHSL((random() - 0.5) * 0.04, 0, (random() - 0.5) * 0.12);
    rocks.setColorAt(i, color);
  });
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  rocks.name = 'rocks';
  return rocks;
}

/** Three crossed blades, merged into one tiny geometry. */
function createTuftGeometry(): BufferGeometry {
  const positions: number[] = [];
  const blades = 3;
  for (let i = 0; i < blades; i++) {
    const angle = (i / blades) * Math.PI;
    const dx = Math.cos(angle) * 0.07;
    const dz = Math.sin(angle) * 0.07;
    const lean = (i - 1) * 0.06;
    const tipY = 0.42 - i * 0.05;
    // Each blade twice with opposite winding, so it is visible from both sides with the same
    // (upward) lighting. DoubleSide would flip the normal on the back and render it dark.
    positions.push(-dx, 0, -dz, dx, 0, dz, lean, tipY, lean * 0.5);
    positions.push(dx, 0, dz, -dx, 0, -dz, lean, tipY, lean * 0.5);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  // Grass lit from above reads better than the real blade normals.
  const normals = geometry.getAttribute('normal');
  for (let i = 0; i < normals.count; i++) normals.setXYZ(i, 0, 1, 0);
  return geometry;
}

function blockedByCollider(x: number, z: number): boolean {
  for (const c of COLLIDERS) {
    if (c.kind === 'cylinder') {
      if (Math.hypot(x - c.x, z - c.z) < c.radius + 0.1) return true;
    } else if (x > c.minX - 0.1 && x < c.maxX + 0.1 && z > c.minZ - 0.1 && z < c.maxZ + 0.1) {
      return true;
    }
  }
  return false;
}

function createGroundCover(random: () => number): Group {
  const group = new Group();
  const tuftCount = 2200;
  const grassMaterial = new MeshStandardMaterial({ roughness: 1 });
  addWindSway(grassMaterial, 0.18, 1);
  const tufts = new InstancedMesh(createTuftGeometry(), grassMaterial, tuftCount);

  const flowerCount = 320;
  const flowerGeometry = new IcosahedronGeometry(0.07, 0);
  flowerGeometry.translate(0, 0.26, 0);
  const flowerMaterial = new MeshStandardMaterial({ roughness: 0.6, flatShading: true });
  addWindSway(flowerMaterial, 0.18, 1);
  const flowers = new InstancedMesh(flowerGeometry, flowerMaterial, flowerCount);
  const flowerColors = ['#ffffff', '#ffe27a', '#d6b4ff', '#ff9e9e', '#ffd1e8'];

  let placedTufts = 0;
  let placedFlowers = 0;
  let attempts = 0;
  while ((placedTufts < tuftCount || placedFlowers < flowerCount) && attempts < 40000) {
    attempts++;
    const angle = random() * Math.PI * 2;
    const r = PLAZA_RADIUS + 0.6 + Math.sqrt(random()) * (PLAY_RADIUS - PLAZA_RADIUS);
    const x = Math.sin(angle) * r;
    const z = -Math.cos(angle) * r;
    if (blockedByCollider(x, z)) continue;
    dummy.position.set(x, terrainHeight(x, z) - 0.02, z);
    dummy.rotation.set(0, random() * Math.PI * 2, 0);
    if (placedTufts < tuftCount) {
      dummy.scale.setScalar(0.7 + random() * 0.8);
      dummy.updateMatrix();
      tufts.setMatrixAt(placedTufts, dummy.matrix);
      color.set('#8fc45e').offsetHSL((random() - 0.5) * 0.05, 0, (random() - 0.5) * 0.12);
      tufts.setColorAt(placedTufts, color);
      placedTufts++;
    } else {
      dummy.scale.setScalar(0.8 + random() * 0.6);
      dummy.updateMatrix();
      flowers.setMatrixAt(placedFlowers, dummy.matrix);
      color.set(flowerColors[Math.floor(random() * flowerColors.length)]!);
      flowers.setColorAt(placedFlowers, color);
      placedFlowers++;
    }
  }
  tufts.count = placedTufts;
  flowers.count = placedFlowers;
  tufts.receiveShadow = true;
  flowers.receiveShadow = true;
  group.add(tufts, flowers);
  group.name = 'ground-cover';
  return group;
}

export function createVegetation(): Group {
  const random = createRandom(99);
  const group = new Group();
  group.add(createTrees(random), createRocks(random), createGroundCover(random));
  return group;
}
