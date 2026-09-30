import { createRandom } from './random.ts';

/**
 * The static world layout. Client and server both build colliders from this, and the client
 * renders from it, so the two can never disagree about where a tree or a step is.
 */

export interface CylinderCollider {
  readonly kind: 'cylinder';
  readonly x: number;
  readonly z: number;
  readonly radius: number;
  readonly bottom: number;
  readonly top: number;
}

export interface BoxCollider {
  readonly kind: 'box';
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly bottom: number;
  readonly top: number;
}

export type Collider = CylinderCollider | BoxCollider;

export type TreeKind = 'round' | 'pine' | 'blossom';

export interface TreeSpot {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly scale: number;
  readonly rotation: number;
  readonly kind: TreeKind;
}

export interface RockSpot {
  readonly x: number;
  readonly z: number;
  readonly y: number;
  readonly scale: number;
  readonly rotation: number;
  readonly solid: boolean;
}

export interface LoreSlot {
  readonly x: number;
  readonly z: number;
  /** Top of the pedestal the object floats above. */
  readonly pedestalTop: number;
  /** Yaw that faces the island center. */
  readonly facing: number;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** Ground height of the island at (x, z). Flat plaza in the middle, rolling hills toward the rim. */
export function terrainHeight(x: number, z: number): number {
  const r = Math.sqrt(x * x + z * z);
  const bowl = smoothstep(10, 32, r) * 1.4;
  const hillMask = smoothstep(16, 22, r) * (1 - smoothstep(31, 34.5, r));
  const hills =
    0.7 * Math.sin(x * 0.19 + 1.7) * Math.cos(z * 0.23 - 0.4) +
    0.45 * Math.sin((x - z) * 0.11 + 0.3) +
    0.35;
  return bowl + hillMask * hills * 1.2;
}

export const SPAWN = { x: 0, z: 7.5, yaw: 0 } as const;

export const PLAZA_RADIUS = 9;

export const FOUNTAIN = {
  basinRadius: 2.8,
  basinHeight: 0.55,
  columnRadius: 0.5,
  columnHeight: 2.4,
  crystalY: 3.5,
} as const;

export const LORE_RING_RADIUS = 13;
export const LORE_SLOT_COUNT = 8;
export const PEDESTAL_RADIUS = 0.7;
export const PEDESTAL_HEIGHT = 0.95;

/** Slots go clockwise (seen from above) starting just left of north, where a new player looks. */
export const LORE_SLOTS: readonly LoreSlot[] = Array.from({ length: LORE_SLOT_COUNT }, (_, i) => {
  const angle = ((i - 0.5) / LORE_SLOT_COUNT) * Math.PI * 2;
  const x = Math.sin(angle) * LORE_RING_RADIUS;
  const z = -Math.cos(angle) * LORE_RING_RADIUS;
  return {
    x,
    z,
    pedestalTop: terrainHeight(x, z) + PEDESTAL_HEIGHT,
    facing: Math.atan2(x, z),
  };
});

export interface RuinBlock {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly bottom: number;
  readonly top: number;
}

function buildRuins(): RuinBlock[] {
  const blocks: RuinBlock[] = [];

  // An old arch on the east side you can walk through (and jump on top of from the stairs, if bold).
  const archX = 24;
  const archBase = terrainHeight(archX, 0) - 0.4;
  blocks.push(
    {
      minX: archX - 0.45,
      maxX: archX + 0.45,
      minZ: -2.1,
      maxZ: -1.2,
      bottom: archBase,
      top: archBase + 3.8,
    },
    {
      minX: archX - 0.45,
      maxX: archX + 0.45,
      minZ: 1.2,
      maxZ: 2.1,
      bottom: archBase,
      top: archBase + 3.8,
    },
    {
      minX: archX - 0.55,
      maxX: archX + 0.55,
      minZ: -2.4,
      maxZ: 2.4,
      bottom: archBase + 3.8,
      top: archBase + 4.4,
    },
  );

  // A stair up to a lookout platform on the west rim. Risers are below STEP_HEIGHT so it is walkable.
  const stairStart = -20.5;
  const stairBase = terrainHeight(stairStart, 0);
  const rise = 0.32;
  const run = 0.45;
  const steps = 10;
  for (let i = 0; i < steps; i++) {
    const maxX = stairStart - i * run;
    blocks.push({
      minX: maxX - run,
      maxX,
      minZ: -1.3,
      maxZ: 1.3,
      bottom: stairBase - 1,
      top: stairBase + rise * (i + 1),
    });
  }
  const platformMaxX = stairStart - steps * run;
  blocks.push({
    minX: platformMaxX - 4,
    maxX: platformMaxX,
    minZ: -2.5,
    maxZ: 2.5,
    bottom: stairBase - 1,
    top: stairBase + rise * (steps + 1),
  });
  return blocks;
}

export const RUIN_BLOCKS: readonly RuinBlock[] = buildRuins();

function nearRuins(x: number, z: number, margin: number): boolean {
  return RUIN_BLOCKS.some(
    (b) => x > b.minX - margin && x < b.maxX + margin && z > b.minZ - margin && z < b.maxZ + margin,
  );
}

function nearLoreSlot(x: number, z: number, margin: number): boolean {
  return LORE_SLOTS.some((s) => Math.hypot(s.x - x, s.z - z) < margin);
}

function buildTrees(): TreeSpot[] {
  const random = createRandom(20260930);
  const kinds: TreeKind[] = ['round', 'round', 'pine', 'pine', 'blossom'];
  const trees: TreeSpot[] = [];
  let attempts = 0;
  while (trees.length < 34 && attempts < 4000) {
    attempts++;
    const angle = random() * Math.PI * 2;
    const r = 18 + Math.sqrt(random()) * 14.5;
    const x = Math.sin(angle) * r;
    const z = -Math.cos(angle) * r;
    const scale = 0.8 + random() * 0.55;
    const rotation = random() * Math.PI * 2;
    const kind = kinds[Math.floor(random() * kinds.length)] ?? 'round';
    if (nearRuins(x, z, 2.8) || nearLoreSlot(x, z, 4)) continue;
    if (trees.some((t) => Math.hypot(t.x - x, t.z - z) < 3)) continue;
    trees.push({ x, z, y: terrainHeight(x, z), scale, rotation, kind });
  }
  return trees;
}

export const TREES: readonly TreeSpot[] = buildTrees();

function buildRocks(): RockSpot[] {
  const random = createRandom(7);
  const rocks: RockSpot[] = [];
  let attempts = 0;
  while (rocks.length < 22 && attempts < 4000) {
    attempts++;
    const angle = random() * Math.PI * 2;
    const r = 11 + random() * 22;
    const x = Math.sin(angle) * r;
    const z = -Math.cos(angle) * r;
    const solid = random() < 0.4;
    const scale = solid ? 0.9 + random() * 0.7 : 0.25 + random() * 0.35;
    const rotation = random() * Math.PI * 2;
    if (nearRuins(x, z, 1.5) || nearLoreSlot(x, z, 2.5)) continue;
    if (TREES.some((t) => Math.hypot(t.x - x, t.z - z) < 1.8)) continue;
    if (rocks.some((o) => Math.hypot(o.x - x, o.z - z) < 1.5)) continue;
    rocks.push({ x, z, y: terrainHeight(x, z), scale, rotation, solid });
  }
  return rocks;
}

export const ROCKS: readonly RockSpot[] = buildRocks();

function buildColliders(): Collider[] {
  const colliders: Collider[] = [
    {
      kind: 'cylinder',
      x: 0,
      z: 0,
      radius: FOUNTAIN.basinRadius,
      bottom: -1,
      top: FOUNTAIN.basinHeight,
    },
    {
      kind: 'cylinder',
      x: 0,
      z: 0,
      radius: FOUNTAIN.columnRadius,
      bottom: -1,
      top: FOUNTAIN.columnHeight,
    },
  ];
  for (const slot of LORE_SLOTS) {
    colliders.push({
      kind: 'cylinder',
      x: slot.x,
      z: slot.z,
      radius: PEDESTAL_RADIUS,
      bottom: slot.pedestalTop - 3,
      top: slot.pedestalTop,
    });
  }
  for (const tree of TREES) {
    colliders.push({
      kind: 'cylinder',
      x: tree.x,
      z: tree.z,
      radius: 0.28 * tree.scale + 0.05,
      bottom: tree.y - 1,
      top: tree.y + 6 * tree.scale,
    });
  }
  for (const rock of ROCKS) {
    if (!rock.solid) continue;
    colliders.push({
      kind: 'cylinder',
      x: rock.x,
      z: rock.z,
      radius: 0.75 * rock.scale,
      bottom: rock.y - 1,
      top: rock.y + 0.9 * rock.scale,
    });
  }
  for (const b of RUIN_BLOCKS) colliders.push({ kind: 'box', ...b });
  return colliders;
}

export const COLLIDERS: readonly Collider[] = buildColliders();
