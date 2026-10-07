import type { Matrix4 } from 'three';
import {
  Box3,
  BoxGeometry,
  Quaternion,
  Texture,
  Triangle,
  Vector3,
  type BufferGeometry,
} from 'three';
import {
  COMPUTER,
  COOLER,
  COOLER_DOOR,
  COUNTER_HEIGHT,
  DOORS,
  EYE_HEIGHT,
  KITCHEN,
  KNIFE_GRAVITY,
  KNIFE_MAX_FLIGHT_SECONDS,
  KNIFE_SPEED,
  PASS_DISHES,
  PENDANT_LAMPS,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SKYLIGHTS,
  SKYLIGHT_WELLS,
  STACKED,
  coolerColliders,
  createRandom,
  flyKnife,
  inPlayArea,
  islandStacks,
  launchKnife,
  shelvingBins,
  type KnifeState,
} from '@world/shared';
import { describe, expect, it, vi } from 'vitest';

/**
 * Knives stick where the kitchen is drawn. Every static part of the kitchen is collected as it is
 * built, and knives are thrown at it with the shared flight the server runs: thousands from where
 * cooks stand, in every direction, and one at each structure. A knife must never fly through
 * anything sizable that is drawn (a thin rail, a small prop, paper or food may let it through), and
 * must never stick short of what it hit, hanging in the air beside it. All of that with the walk-in
 * shut, and open, when knives fly through its doorway into the cold room.
 */

vi.mock('./textures.ts', () => ({
  everySecondCountsTexture: () => new Texture(),
  exitSignTexture: () => new Texture(),
  softTexture: () => new Texture(),
}));

const { Kit } = await import('./kit.ts');
const { buildKitchen } = await import('./kitchen.ts');
const { buildStationProps } = await import('./props.ts');
const { buildComputerDesk } = await import('./computer.ts');

/** How far a stuck knife may be from where the kitchen is drawn, and how far through it. */
const TOLERANCE = 0.02;

interface Part {
  readonly layer: string;
  /** Its triangles, nine numbers each, in world space. */
  readonly triangles: Float32Array;
  readonly bounds: Box3;
  /** Whether a knife may fly through it, and why. */
  readonly passable: string | null;
}

const TOP = COUNTER_HEIGHT;

/** Why a knife may fly through a drawn part, if it may. */
function passable(
  geometry: BufferGeometry,
  matrix: Matrix4 | undefined,
  rod: boolean,
  bounds: Box3,
): string | null {
  if (rod || geometry.type === 'TorusGeometry') return 'a rod or a ring';
  // Its own size, before it is turned into place.
  geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new Vector3());
  if (matrix) {
    const scale = new Vector3();
    matrix.decompose(new Vector3(), new Quaternion(), scale);
    size.multiply(scale.set(Math.abs(scale.x), Math.abs(scale.y), Math.abs(scale.z)));
  }
  const [thinnest, middle] = [size.x, size.y, size.z].sort((a, b) => a - b);
  if (geometry.type === 'BoxGeometry' && thinnest! < 0.005) return 'paper';
  if (middle! < 0.04) return 'a rod or a ring';
  if (size.length() <= 0.3) return 'small';
  const center = bounds.getCenter(new Vector3());
  const onDish = PASS_DISHES.some(
    (d) => Math.hypot(center.x - d.x, center.z - d.z) < d.radius && bounds.max.y < TOP + 0.25,
  );
  if (onDish) return 'food';
  return null;
}

/** Every part of the static kitchen, as the client builds it. */
function drawnKitchen(): Part[] {
  const kit = new Kit();
  const parts: Part[] = [];
  let inRod = false;
  const add = kit.add.bind(kit);
  const rod = kit.rod.bind(kit);
  kit.rod = (...args) => {
    inRod = true;
    rod(...args);
    inRod = false;
  };
  kit.add = (layer, geometry, matrix, color) => {
    const placed = geometry.clone();
    if (matrix) placed.applyMatrix4(matrix);
    const mirrored = matrix !== undefined && matrix.determinant() < 0;
    const { triangles, bounds } = trianglesOf(placed, mirrored);
    parts.push({ layer, triangles, bounds, passable: passable(geometry, matrix, inRod, bounds) });
    add(layer, geometry, matrix, color);
  };
  buildKitchen(kit);
  buildStationProps(kit);
  buildComputerDesk(kit);
  return parts;
}

/** A placed geometry's triangles, wound to face out as the builder keeps them when mirrored. */
function trianglesOf(
  placed: BufferGeometry,
  mirrored: boolean,
): { triangles: Float32Array; bounds: Box3 } {
  const position = placed.getAttribute('position');
  const index = placed.index;
  const count = index ? index.count : position.count;
  const triangles = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const corner = mirrored && i % 3 !== 0 ? i + (i % 3 === 1 ? 1 : -1) : i;
    const v = index ? index.getX(corner) : corner;
    triangles.set([position.getX(v), position.getY(v), position.getZ(v)], i * 3);
  }
  placed.computeBoundingBox();
  return { triangles, bounds: placed.boundingBox!.clone() };
}

/**
 * The walk-in's door, which is CoolerDoor's own mesh rather than the Kit's: a 10 cm steel slab, its
 * face flush with the wall in the doorway while it is shut, swung in flat against the cold room's
 * south wall once it is open. Its handle and hinges are rods.
 */
function doorSlab(open: boolean): Part {
  const d = COOLER_DOOR;
  const [min, max] = open
    ? [
        new Vector3(d.hingeX, d.bottom, d.hingeZ - d.thickness),
        new Vector3(d.hingeX + (d.to - d.from), d.top, COOLER.maxZ),
      ]
    : [new Vector3(d.face, d.bottom, d.from), new Vector3(d.face + d.thickness, d.top, d.to)];
  const size = max.clone().sub(min);
  const center = min.clone().add(max).multiplyScalar(0.5);
  const slab = new BoxGeometry(size.x, size.y, size.z).translate(center.x, center.y, center.z);
  return { layer: 'cooler door', ...trianglesOf(slab, false), passable: null };
}

/** The kitchen as drawn, with the walk-in shut or open. */
interface Drawn {
  readonly open: boolean;
  readonly parts: readonly Part[];
  /** The parts a knife may not fly through. */
  readonly solid: readonly Part[];
}

const KIT_PARTS = drawnKitchen();
function drawn(open: boolean): Drawn {
  const parts = [...KIT_PARTS, doorSlab(open)];
  return { open, parts, solid: parts.filter((p) => p.passable === null) };
}
const SHUT = drawn(false);
const OPEN = drawn(true);

const scratch = { a: new Vector3(), b: new Vector3(), c: new Vector3(), n: new Vector3() };

/** A drawn surface a knife meets: how far along its segment (0 to 1), whose, and which way it faces. */
interface Meeting {
  readonly t: number;
  readonly part: Part;
  readonly normal: Vector3;
}

/** The first drawn surface along the segment from `p` by `d`. */
function firstDrawn(parts: readonly Part[], p: Vector3, d: Vector3): Meeting | null {
  let best: Meeting | null = null;
  const end = p.clone().add(d);
  const reach = new Box3().setFromPoints([p, end]).expandByScalar(1e-4);
  for (const part of parts) {
    if (!part.bounds.intersectsBox(reach)) continue;
    const tr = part.triangles;
    for (let i = 0; i < tr.length; i += 9) {
      const e1x = tr[i + 3]! - tr[i]!;
      const e1y = tr[i + 4]! - tr[i + 1]!;
      const e1z = tr[i + 5]! - tr[i + 2]!;
      const e2x = tr[i + 6]! - tr[i]!;
      const e2y = tr[i + 7]! - tr[i + 1]!;
      const e2z = tr[i + 8]! - tr[i + 2]!;
      const hx = d.y * e2z - d.z * e2y;
      const hy = d.z * e2x - d.x * e2z;
      const hz = d.x * e2y - d.y * e2x;
      const det = e1x * hx + e1y * hy + e1z * hz;
      if (Math.abs(det) < 1e-14) continue;
      const sx = p.x - tr[i]!;
      const sy = p.y - tr[i + 1]!;
      const sz = p.z - tr[i + 2]!;
      const u = (sx * hx + sy * hy + sz * hz) / det;
      if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y;
      const qy = sz * e1x - sx * e1z;
      const qz = sx * e1y - sy * e1x;
      const v = (d.x * qx + d.y * qy + d.z * qz) / det;
      if (v < 0 || u + v > 1) continue;
      const t = (e2x * qx + e2y * qy + e2z * qz) / det;
      if (t < 0 || t > 1 || (best && t >= best.t)) continue;
      const normal = new Vector3(
        e1y * e2z - e1z * e2y,
        e1z * e2x - e1x * e2z,
        e1x * e2y - e1y * e2x,
      );
      best = { t, part, normal: normal.normalize() };
    }
  }
  return best;
}

/** How far `point` is from the nearest drawn surface of `parts`, or `limit` if none is nearer. */
function distanceToDrawn(parts: readonly Part[], point: Vector3, limit: number): number {
  const near = new Box3(point.clone(), point.clone()).expandByScalar(limit);
  const triangle = new Triangle();
  const closest = new Vector3();
  let best = limit;
  for (const part of parts) {
    if (!part.bounds.intersectsBox(near)) continue;
    const tr = part.triangles;
    for (let i = 0; i < tr.length; i += 9) {
      scratch.a.set(tr[i]!, tr[i + 1]!, tr[i + 2]);
      scratch.b.set(tr[i + 3]!, tr[i + 4]!, tr[i + 5]);
      scratch.c.set(tr[i + 6]!, tr[i + 7]!, tr[i + 8]);
      triangle.set(scratch.a, scratch.b, scratch.c).closestPointToPoint(point, closest);
      best = Math.min(best, closest.distanceTo(point));
    }
  }
  return best;
}

interface Landing {
  /** Where the knife met what it hit, short of where its tip sank in; null if it hit nothing. */
  readonly contact: Vector3 | null;
  readonly tip: Vector3 | null;
  /** What is wrong with it, if anything. */
  readonly fault: string | null;
}

const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z);
const where = (p: Vector3) => `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;

/**
 * Fly a knife step by step, as the server does, and judge it against the drawn kitchen: once it
 * flies into something sizable it must neither get more than TOLERANCE inside it nor come out of
 * its far side, and it must stick within TOLERANCE of something drawn. (Out through a side next to
 * the one it went in by is a knife clipping a corner, which only matters if it goes deep.)
 */
function land(knife: KnifeState, world: Drawn = SHUT): Landing {
  const path = [v3(knife.x, knife.y, knife.z)];
  let entry: (Meeting & { at: Vector3; step: number }) | null = null;
  let impact: ReturnType<typeof flyKnife> = null;
  while (!impact && knife.t < KNIFE_MAX_FLIGHT_SECONDS) {
    impact = flyKnife(knife, 1 / 80, [], -1, world.open);
    const from = path[path.length - 1]!;
    const at = v3(knife.x, knife.y, knife.z);
    path.push(at);
    if (!entry) {
      const hit = firstDrawn(world.solid, from, at.clone().sub(from));
      if (hit) entry = { ...hit, at: from.clone().lerp(at, hit.t), step: path.length - 2 };
    }
  }
  const contact = impact ? path[path.length - 1]! : null;
  if (impact && impact.kind !== 'surface') return { contact, tip: null, fault: 'hit a player' };
  if (entry) {
    // Along the path from where it went in to where it comes out again, or sticks.
    const along: Vector3[] = [entry.at];
    let exit: Meeting | null = null;
    for (let i = entry.step; i + 1 < path.length; i++) {
      const from = i === entry.step ? entry.at : path[i]!;
      const to = path[i + 1]!;
      const d = to.clone().sub(from);
      const start = from.clone().addScaledVector(d.clone().normalize(), 1e-4);
      exit = firstDrawn(world.solid, start, to.clone().sub(start));
      if (exit) {
        along.push(start.lerp(to, exit.t));
        break;
      }
      along.push(to);
    }
    const out = along[along.length - 1]!;
    const stuckThere = contact !== null && contact.distanceTo(out) <= TOLERANCE;
    if (exit && !stuckThere && exit.normal.dot(entry.normal) < -0.3) {
      return {
        contact,
        tip: null,
        fault: `flies through a ${entry.part.layer} part at ${where(entry.at)}`,
      };
    }
    let deepest = 0;
    for (let i = 0; i + 1 < along.length; i++) {
      const length = along[i]!.distanceTo(along[i + 1]!);
      for (let s = 0; s <= length; s += 0.005) {
        const point = along[i]!.clone().lerp(along[i + 1]!, length > 0 ? s / length : 0);
        deepest = Math.max(deepest, distanceToDrawn(world.solid, point, 0.1));
      }
    }
    if (deepest > TOLERANCE) {
      const depth = deepest >= 0.1 ? 'right through' : `${(deepest * 100).toFixed(1)} cm into`;
      return {
        contact,
        tip: null,
        fault: `flies ${depth} a ${entry.part.layer} part at ${where(entry.at)}`,
      };
    }
  }
  if (!contact) return { contact, tip: null, fault: null };
  const gap = distanceToDrawn(world.parts, contact, 0.2);
  const fault =
    gap > TOLERANCE ? `sticks ${(gap * 100).toFixed(1)} cm off the drawn kitchen` : null;
  return { contact, tip: v3(impact!.x, impact!.y, impact!.z), fault };
}

/** Whether a cook can stand at (x, z), with the walk-in shut or open. */
function standable(x: number, z: number, open = false): boolean {
  if (!inPlayArea(x, z, open)) return false;
  return coolerColliders(open).every((c) => {
    if (c.kind !== 'box' || c.bottom > EYE_HEIGHT) return true;
    const dx = Math.max(c.minX - x, 0, x - c.maxX);
    const dz = Math.max(c.minZ - z, 0, z - c.maxZ);
    return Math.hypot(dx, dz) >= PLAYER_RADIUS;
  });
}

/** How high a cook's eye gets at the top of a jump at (x, z), under whatever hangs over them. */
function jumpEye(x: number, z: number, open: boolean): number {
  let ceiling = Infinity;
  for (const c of coolerColliders(open)) {
    if (c.kind !== 'box' || c.bottom <= EYE_HEIGHT) continue;
    const dx = Math.max(c.minX - x, 0, x - c.maxX);
    const dz = Math.max(c.minZ - z, 0, z - c.maxZ);
    if (Math.hypot(dx, dz) < PLAYER_RADIUS) ceiling = Math.min(ceiling, c.bottom);
  }
  return Math.min(EYE_HEIGHT + 0.8, ceiling - (PLAYER_HEIGHT - EYE_HEIGHT));
}

/** A throw from `eye` whose arc passes through `target` (the low one of the two). */
function aimAt(eye: Vector3, target: Vector3): KnifeState {
  const dx = target.x - eye.x;
  const dz = target.z - eye.z;
  const d = Math.hypot(dx, dz);
  const h = target.y - eye.y;
  const v2 = KNIFE_SPEED * KNIFE_SPEED;
  const g = KNIFE_GRAVITY;
  const pitch = Math.atan((v2 - Math.sqrt(v2 * v2 - g * (g * d * d + 2 * h * v2))) / (g * d));
  return launchKnife(eye.x, eye.y, eye.z, Math.atan2(-dx, -dz), pitch);
}

/**
 * Throw knives every which way from wherever a cook can stand west to east between `fromX` and
 * `toX`, standing and mid-jump, and list what went wrong, one example of each kind.
 */
function sweep(
  world: Drawn,
  fromX: number,
  toX: number,
  seed: number,
): { throws: number; faults: string[] } {
  const random = createRandom(seed);
  const faults = new Map<string, { count: number; example: string }>();
  let throws = 0;
  for (let x = fromX; x <= toX; x += 0.5) {
    for (let z = -6; z <= 6; z += 0.5) {
      if (!standable(x, z, world.open)) continue;
      for (const y of [EYE_HEIGHT, jumpEye(x, z, world.open)]) {
        for (let i = 0; i < 16; i++) {
          const yaw = random() * Math.PI * 2;
          const pitch = -1.1 + random() * 2.5;
          const { fault } = land(launchKnife(x, y, z, yaw, pitch), world);
          throws++;
          if (!fault) continue;
          const key = fault.replace(/ at \(.*\)$/, '').replace(/[\d.]+ cm/, 'some');
          const entry = faults.get(key) ?? { count: 0, example: '' };
          entry.count++;
          entry.example ||= `${fault}, thrown from ${where(v3(x, y, z))} yaw ${yaw.toFixed(3)} pitch ${pitch.toFixed(3)}`;
          faults.set(key, entry);
        }
      }
    }
  }
  return { throws, faults: [...faults.values()].map((f) => `${f.count}x ${f.example}`) };
}

describe('knives stick where the kitchen is drawn', () => {
  it('from wherever a cook stands, standing or jumping, thrown any way', () => {
    const { throws, faults } = sweep(SHUT, -7.5, 7.5, 4242);
    expect(throws).toBeGreaterThan(10000);
    expect(faults).toEqual([]);
  }, 60_000);

  it('with the walk-in open, from by its doorway and inside it', () => {
    const { throws, faults } = sweep(OPEN, 3, COOLER.maxX, 77);
    expect(throws).toBeGreaterThan(3000);
    expect(faults).toEqual([]);
  }, 60_000);

  const hood = KITCHEN.hood;
  const pendant = PENDANT_LAMPS[1]!;
  const shelf = KITCHEN.shelving;
  const tub = shelvingBins().find((b) => b.kind === 'tub')!;
  const stacks = islandStacks(KITCHEN.gardeManger);
  const plates = stacks.find((s) => s.y > 0.5 && !s.bowls)!;
  const plateHeight = (plates.count - 1) * STACKED.plate.step + STACKED.plate.height;
  const well = SKYLIGHT_WELLS[0]!;
  const skylight = v3(
    1,
    (well.a.y + well.b.y) / 2 + SKYLIGHTS.glass * well.out.y,
    (well.a.z + well.b.z) / 2 + SKYLIGHTS.glass * well.out.z,
  );
  const crt = { front: COMPUTER.x - 0.03, y: COMPUTER.y, z: COMPUTER.z };
  const stand = EYE_HEIGHT;
  const jump = EYE_HEIGHT + 0.8;
  const walkIn = DOORS.walkIn;

  /** A structure, a place a cook could throw from, and a point on its drawn surface. */
  const structures: readonly {
    readonly name: string;
    readonly eye: Vector3;
    readonly target: Vector3;
    /** Thin enough that a tip sunk too deep would poke out the far side. */
    readonly thin?: boolean;
    /** With the walk-in open. */
    readonly open?: boolean;
  }[] = [
    {
      name: 'the hood skirt, from the islands',
      eye: v3(1, stand, -3.2),
      target: v3(1, 2.9, hood.minZ),
      thin: true,
    },
    {
      name: 'the hood skirt, from its east end',
      eye: v3(6.5, stand, 1),
      target: v3(hood.maxX, 2.9, 1),
      thin: true,
    },
    {
      name: "the hood's lit underside",
      eye: v3(2, stand, 2.6),
      target: v3(2, hood.top - 0.051, 1),
    },
    {
      name: "the hood's body over the skirt",
      eye: v3(-2, stand, -5.3),
      target: v3(-2, 3.8, hood.minZ),
    },
    {
      name: 'a star plaque on the hood',
      eye: v3(0.1, stand, -5.3),
      target: v3(0.1, 4.0, hood.minZ - 0.03),
    },
    {
      name: 'a pendant shade, from the side',
      eye: v3(-0.5, stand, -3.2),
      target: v3(pendant.x + 0.2214, pendant.y + 0.05, pendant.z),
      thin: true,
    },
    {
      name: 'up inside a pendant shade',
      eye: v3(pendant.x, stand, -3.2),
      target: v3(pendant.x, pendant.y + 0.19, pendant.z + 0.02),
      thin: true,
    },
    {
      name: 'the heat lamp housing over the pass',
      eye: v3(1, stand, 2.6),
      target: v3(1, 2.24, 4.12),
    },
    { name: 'under the heat lamp housing', eye: v3(0.75, stand, 5.6), target: v3(0.75, 2.18, 4.3) },
    {
      name: 'a heat lamp shade',
      eye: v3(0, stand, 5.6),
      target: v3(0, 2.1, 4.3 + 0.098),
      thin: true,
    },
    {
      name: 'a post of the heat lamp gantry',
      eye: v3(-4.3, stand, 2.6),
      target: v3(-4.3, 1.5, 4.3 - 0.028),
    },
    {
      name: 'the high shelf on the piano',
      eye: v3(2.5, stand, 2.6),
      target: v3(2.5, 1.515, 0.2),
      thin: true,
    },
    {
      name: 'the plates on the high shelf',
      eye: v3(-3.4, stand, 2.6),
      target: v3(-3.4, 1.58, 0.14),
    },
    { name: 'an oven door', eye: v3(-1.2, stand, 2.6), target: v3(-1.2, 0.5, 1.427) },
    {
      name: 'the plates under an island',
      eye: v3(plates.x, stand, -1.85),
      target: v3(plates.x, plates.y + plateHeight / 2, plates.z + 0.14),
    },
    {
      name: 'a tub on the storage shelving',
      eye: v3(5.5, stand, tub.z),
      target: v3(shelf.minX + 0.06, tub.y + 0.14, tub.z),
    },
    {
      name: 'a shelf of the sheet-pan rack',
      eye: v3(-5.5, stand, -1.6),
      target: v3(-7.44, 0.22 + 5 * 0.13 + 0.006, -1.6),
      thin: true,
    },
    { name: 'the fridge door', eye: v3(5.5, stand, -0.2), target: v3(7.12, 1, -0.2) },
    {
      name: 'the splash behind the window counter',
      eye: v3(3, stand, -5.3),
      target: v3(3, 1.1, -6.47),
    },
    { name: 'a garden window', eye: v3(2, stand, -5.3), target: v3(2, 2, -6.6) },
    { name: 'a skylight', eye: v3(1, stand, -2.6), target: skylight },
    { name: 'Every Second Counts', eye: v3(0.5, stand, -5.3), target: v3(0.5, 3.035, -6.488) },
    { name: 'the light line under the vault', eye: v3(3, stand, 5.6), target: v3(3, 3.36, 6.45) },
    {
      name: 'the clock over the dining room doors',
      eye: v3(0.3, stand, 5.6),
      target: v3(0.3, 2.875, 6.44),
    },
    { name: 'a dining room door', eye: v3(0.6, stand, 5.6), target: v3(0.6, 1, 6.455) },
    { name: 'the back door', eye: v3(-6.5, stand, 3), target: v3(-7.92, 1, 3) },
    { name: 'the exit sign', eye: v3(-6, stand, 3), target: v3(-7.92, 2.52, 3.1) },
    {
      name: 'the hotel pans over the dish pit',
      eye: v3(6.3, stand, 5.4),
      target: v3(6.3, 2, 6.13),
    },
    {
      name: "the computer's tube, from above",
      eye: v3(-6.3, jump, 5.6),
      target: v3(crt.front - 0.2, crt.y + 0.155, crt.z),
    },
    {
      name: 'the big stockpot on the piano',
      eye: v3(-0.55, stand, 2.6),
      target: v3(-0.55, 1.2, 0.27),
    },
    { name: 'the croquembouche', eye: v3(-3.2, stand, -3.2), target: v3(-3.2, 1.3, -4.076) },
    { name: 'the cheese cloche', eye: v3(3.2, stand, -3.2), target: v3(3.2, 1.104, -4.066) },
    { name: 'the stand mixer', eye: v3(-2.22, stand, -3.2), target: v3(-2.22, 1.34, -4.225) },
    {
      name: 'the shut walk-in door, flush with the wall',
      eye: v3(6.5, stand, -3),
      target: v3(COOLER_DOOR.face, 1.2, -3),
    },
    {
      name: "the walk-in's steel frame",
      eye: v3(6.5, stand, -1.5),
      target: v3(COOLER_DOOR.face - 0.05, 1.5, walkIn.to + 0.06),
    },
    {
      name: 'the controller beside the walk-in',
      eye: v3(6.5, stand, walkIn.from - 0.34),
      target: v3(COOLER_DOOR.face - 0.05, 1.6, walkIn.from - 0.34),
    },
    {
      name: "the cold room's back wall, through the open door",
      eye: v3(6.5, stand, -3),
      target: v3(COOLER.maxX, 1.2, -3.5),
      open: true,
    },
    {
      name: 'the open walk-in door, swung back inside',
      eye: v3(6.5, stand, -3.4),
      target: v3(9.5, 1.2, COOLER_DOOR.hingeZ - COOLER_DOOR.thickness),
      open: true,
    },
  ];

  it.each(structures)('in $name', ({ eye, target, thin, open = false }) => {
    const world = open ? OPEN : SHUT;
    expect(standable(eye.x, eye.z, open)).toBe(true);
    const { contact, tip, fault } = land(aimAt(eye, target), world);
    expect(fault).toBeNull();
    expect(contact).not.toBeNull();
    expect(contact!.distanceTo(target)).toBeLessThan(TOLERANCE);
    if (thin) {
      // The tip stays inside: nothing drawn between where the knife met the surface and its tip.
      const into = tip!.clone().sub(contact!);
      const start = contact!.clone().addScaledVector(into.clone().normalize(), 0.003);
      expect(firstDrawn(world.parts, start, tip!.clone().sub(start))).toBeNull();
    }
  });
});
