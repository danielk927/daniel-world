import { describe, expect, it } from 'vitest';
import {
  EYE_HEIGHT,
  KNIFE_EMBED,
  KNIFE_GRAVITY,
  KNIFE_MAX_FLIGHT_SECONDS,
  KNIFE_SPEED,
  ROOM_HALF_Z,
} from './constants.ts';
import {
  flyKnife,
  launchKnife,
  type KnifeImpact,
  type KnifeState,
  type KnifeTarget,
} from './knife.ts';
import {
  COMPUTER,
  KITCHEN,
  KNIFE_SOLIDS,
  HEAT_LAMP_HOUSING_Y,
  HEAT_LAMP_SHADE,
  PENDANT_LAMPS,
  PENDANT_SHADE,
  SKYLIGHTS,
  SKYLIGHT_WELLS,
  VAULT_EDGES,
  WINDOWS,
  WINDOW_GLASS_DEPTH,
  type Ring,
  type ShadeOutline,
} from './world.ts';

/** Fly a knife until something is hit (or the flight runs out). */
function fly(
  knife: KnifeState,
  targets: readonly KnifeTarget[] = [],
  thrower = -1,
): KnifeImpact | null {
  for (let i = 0; i < 200; i++) {
    const impact = flyKnife(knife, 1 / 20, targets, thrower);
    if (impact) return impact;
    if (knife.t >= KNIFE_MAX_FLIGHT_SECONDS) return null;
  }
  return null;
}

/** Throw from an eye position and fly until something is hit (or the flight runs out). */
function throwFrom(
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  targets: readonly KnifeTarget[] = [],
  thrower = -1,
): KnifeImpact | null {
  return fly(launchKnife(x, y, z, yaw, pitch), targets, thrower);
}

type Point = readonly [number, number, number];

/**
 * Throw from `eye` along the arc through `target` (the low one), and return where the knife met
 * what it hit (where the flight leaves it) and where its tip sank in.
 */
function throwAt(eye: Point, target: Point): { contact: Point; tip: Point; dir: Point } {
  const [dx, dy, dz] = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]];
  const d = Math.hypot(dx, dz);
  const v2 = KNIFE_SPEED * KNIFE_SPEED;
  const g = KNIFE_GRAVITY;
  const pitch = Math.atan((v2 - Math.sqrt(v2 * v2 - g * (g * d * d + 2 * dy * v2))) / (g * d));
  const knife = launchKnife(eye[0], eye[1], eye[2], Math.atan2(-dx, -dz), pitch);
  const hit = fly(knife);
  if (hit?.kind !== 'surface') throw new Error(`the knife hit ${hit?.kind ?? 'nothing'}`);
  return {
    contact: [knife.x, knife.y, knife.z],
    tip: [hit.x, hit.y, hit.z],
    dir: [hit.dx, hit.dy, hit.dz],
  };
}

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** The radius of an outline at a height over its bottom, or -1 off its ends. */
function radiusAt(rings: readonly Ring[], y: number): number {
  for (let i = 0; i + 1 < rings.length; i++) {
    const [[r0, y0], [r1, y1]] = [rings[i]!, rings[i + 1]!];
    if (y >= y0 && y <= y1) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return -1;
}

/** Whether a point is in the wall of a lamp shade whose rim is centered on `rim`. */
function inShadeWall(shade: ShadeOutline, rim: Point, point: Point): boolean {
  const y = point[1] - rim[1];
  const r = Math.hypot(point[0] - rim[0], point[2] - rim[2]);
  const outside = radiusAt(shade.outside, y);
  const inside = radiusAt(shade.inside, y);
  return r <= outside && (inside < 0 || r >= inside);
}

/** The vault's height over z, as it is built: flat facets between its edges. */
function facetHeight(z: number): number {
  const i = VAULT_EDGES.findIndex((edge, k) => k > 0 && z <= edge.z) - 1;
  const [a, b] = [VAULT_EDGES[i]!, VAULT_EDGES[i + 1]!];
  return a.y + ((z - a.z) / (b.z - a.z)) * (b.y - a.y);
}

const NORTH = 0;
const EAST = -Math.PI / 2;
const WEST = Math.PI / 2;
const DOWN = -Math.PI / 2 + 0.01;
const UP = Math.PI / 2 - 0.01;
const STAND = EYE_HEIGHT;
const hood = KITCHEN.hood;
/** The hood's steel skirt is 4 cm thick and stops 5 cm short of its top, under its body. */
const SKIRT = 0.04;
const HOOD_UNDERSIDE = hood.top - 0.05;

describe('knife flight', () => {
  it('leaves the eye at throwing speed, along the view direction', () => {
    const k = launchKnife(1, 1.6, 2, NORTH, 0);
    expect([k.x, k.y, k.z]).toEqual([1, 1.6, 2]);
    expect(k.vx).toBeCloseTo(0);
    expect(k.vz).toBeCloseTo(-KNIFE_SPEED);
    const east = launchKnife(0, 1.6, 0, EAST, 0);
    expect(east.vx).toBeCloseTo(KNIFE_SPEED);
  });

  it('sticks into the floor, blade first, a little below the surface', () => {
    // The aisle between the piano and the pass is clear floor.
    const hit = throwFrom(0, 1.6, 2.6, NORTH, DOWN);
    expect(hit?.kind).toBe('surface');
    if (hit?.kind !== 'surface') return;
    expect(hit.y).toBeCloseTo(-KNIFE_EMBED * Math.abs(hit.dy), 2);
    expect(hit.dy).toBeLessThan(-0.99);
    expect(hit.z).toBeCloseTo(2.6, 1);
  });

  it('sticks into the kitchen computer, not the wall behind it', () => {
    // Thrown west at the screen from the aisle by the desk.
    const hit = throwFrom(-6.3, COMPUTER.y + 0.05, COMPUTER.z, WEST, 0);
    expect(hit?.kind).toBe('surface');
    if (hit?.kind !== 'surface') return;
    expect(hit.x).toBeGreaterThan(COMPUTER.x - 0.1);
    expect(hit.x).toBeLessThan(COMPUTER.x);
  });

  it('sticks into the face of a fixture it flies into', () => {
    // Thrown east at chest height, it meets the fridge's glass door, set back 2 cm in its frame.
    const hit = throwFrom(5.5, 1.5, -0.2, EAST, 0);
    expect(hit?.kind).toBe('surface');
    if (hit?.kind !== 'surface') return;
    expect(hit.x).toBeCloseTo(KITCHEN.fridge.minX + 0.02 + KNIFE_EMBED, 2);
    expect(hit.dx).toBeGreaterThan(0.99);
  });

  it('drops a little on a long throw', () => {
    // Level from the dining room side, across the pass and under the hood.
    const hit = throwFrom(0, 1.62, 5.6, NORTH, 0);
    expect(hit?.kind).toBe('surface');
    if (hit?.kind !== 'surface') return;
    expect(hit.y).toBeLessThan(1.62);
    expect(hit.dy).toBeLessThan(0);
  });

  it('sticks into the vault from below, where its facets are', () => {
    const vault = throwFrom(0, 1.6, 5, NORTH, UP);
    expect(vault?.kind).toBe('surface');
    if (vault?.kind !== 'surface') return;
    expect(vault.y).toBeCloseTo(facetHeight(vault.z) + KNIFE_EMBED * vault.dy, 2);
  });

  it('hits a player it passes through, and never the thrower', () => {
    const target: KnifeTarget = { id: 7, x: 0, y: 0, z: 3 };
    const hit = throwFrom(0, 1.62, 5.6, NORTH, -0.1, [target]);
    expect(hit).toMatchObject({ kind: 'player', id: 7 });
    if (hit?.kind !== 'player') return;
    expect(hit.z).toBeGreaterThan(3);
    // Standing in the knife's way, but it is their own knife.
    const own = throwFrom(0, 1.62, 5.6, NORTH, -0.1, [{ ...target, id: 3 }], 3);
    expect(own?.kind).toBe('surface');
  });

  it('misses a player it flies over or past', () => {
    const target: KnifeTarget = { id: 7, x: 0, y: 0, z: 3 };
    expect(throwFrom(0, 1.62, 5.6, NORTH, 0.6, [target])?.kind).toBe('surface');
    expect(throwFrom(0.6, 1.62, 5.6, NORTH, -0.1, [target])?.kind).toBe('surface');
  });

  it('is deterministic, so every client can replay a flight the server announced', () => {
    const a = throwFrom(0.3, 1.62, 5.6, 0.2, 0.1);
    const b = throwFrom(0.3, 1.62, 5.6, 0.2, 0.1);
    expect(a).toEqual(b);
  });
});

describe('knives in the structures of the kitchen', () => {
  it('stick into the face of the hood skirt, from the islands and from its end', () => {
    const front = throwAt([1, STAND, -3.2], [1, 2.9, hood.minZ]);
    expect(front.contact[2]).toBeCloseTo(hood.minZ, 2);
    // Sunk into the 4 cm skirt, not out of the back of it.
    expect(front.tip[2]).toBeGreaterThan(hood.minZ);
    expect(front.tip[2]).toBeLessThan(hood.minZ + SKIRT);
    const side = throwAt([6.5, STAND, 1], [hood.maxX, 2.9, 1]);
    expect(side.contact[0]).toBeCloseTo(hood.maxX, 2);
    expect(side.tip[0]).toBeGreaterThan(hood.maxX - SKIRT);
  });

  it('fly on under the skirt into the hood and stick in its lit underside', () => {
    // Straight up from over the stoves: past the skirt's bottom edge, up to the filters.
    const up = throwFrom(0, 1.6, 0, NORTH, UP);
    expect(up?.kind === 'surface' && up.y).toBeCloseTo(HOOD_UNDERSIDE + KNIFE_EMBED, 2);
    // And at a slant from the aisle, in under the skirt.
    const slant = throwAt([2, STAND, 2.6], [2, HOOD_UNDERSIDE, 1]);
    expect(slant.contact[1]).toBeCloseTo(HOOD_UNDERSIDE, 2);
    expect(distance(slant.contact, [2, HOOD_UNDERSIDE, 1])).toBeLessThan(0.02);
  });

  it('stick into the hood body, boxed up to the vault over the skirt', () => {
    const body = throwAt([-2, STAND, -5.3], [-2, 3.8, hood.minZ]);
    expect(distance(body.contact, [-2, 3.8, hood.minZ])).toBeLessThan(0.02);
    expect(body.tip[2]).toBeCloseTo(hood.minZ + KNIFE_EMBED * body.dir[2], 2);
  });

  it('stick into a pendant shade from the side, sunk in its thin wall and not through it', () => {
    const p = PENDANT_LAMPS[1]!;
    // Up the shade's lower flank, on the side facing east.
    const [[r0, y0], [r1, y1]] = PENDANT_SHADE.outside as [[number, number], [number, number]];
    const radius = r0 + ((r1 - r0) * (0.05 - y0)) / (y1 - y0);
    const target: Point = [p.x + radius, p.y + 0.05, p.z];
    const side = throwAt([-0.5, STAND, -3.2], target);
    expect(distance(side.contact, target)).toBeLessThan(0.01);
    // The wall is a centimeter thick; this knife climbs almost along it, and its tip stays in it.
    expect(distance(side.contact, side.tip)).toBeGreaterThan(0.003);
    expect(inShadeWall(PENDANT_SHADE, [p.x, p.y, p.z], side.tip)).toBe(true);
    // Square on to the flank, which faces out and up, it sinks in barely a centimeter.
    const square = throwAt([p.x + 2, p.y + 0.05 + 2 * 0.57, p.z], target);
    expect(distance(square.contact, square.tip)).toBeLessThan(0.012);
    expect(inShadeWall(PENDANT_SHADE, [p.x, p.y, p.z], square.tip)).toBe(true);
  });

  it('fly up into a pendant shade and stick in its inside', () => {
    const p = PENDANT_LAMPS[1]!;
    const top = PENDANT_SHADE.inside[PENDANT_SHADE.inside.length - 1]![1];
    const target: Point = [p.x, p.y + top, p.z + 0.02];
    const inside = throwAt([p.x, STAND, -3.2], target);
    expect(distance(inside.contact, target)).toBeLessThan(0.01);
    // The shade's top is a centimeter thick; the tip does not come out of it.
    const outsideTop = PENDANT_SHADE.outside[PENDANT_SHADE.outside.length - 1]![1];
    expect(inside.tip[1]).toBeLessThan(p.y + outsideTop);
  });

  it('fly freely between the pendants and close by them', () => {
    const [a, b] = [PENDANT_LAMPS[0]!, PENDANT_LAMPS[1]!];
    // North over the pastry island at shade height, midway between its two lamps, and 5 cm
    // clear of a shade's rim: neither stops before the lamps' row.
    for (const x of [(a.x + b.x) / 2, b.x + PENDANT_SHADE.outside[0]![0] + 0.05]) {
      const knife = launchKnife(x, STAND + 0.8, -3.2, NORTH, 0.55);
      const hit = fly(knife);
      expect(hit?.kind).toBe('surface');
      expect(knife.z).toBeLessThan(b.z - 0.5);
    }
  });

  it('fly freely under the hood, between the high shelf and the skirt', () => {
    // East along the piano under the hood, from beyond its west end: nothing stops it there.
    const knife = launchKnife(-6.5, 2.45, 1.7, EAST, 0.02);
    expect(fly(knife)?.kind).toBe('surface');
    expect(knife.x).toBeGreaterThan(hood.maxX);
  });

  it('stick into the heat lamp gantry over the pass: its housing, a lamp and a post', () => {
    const cz = (KITCHEN.pass.minZ + KITCHEN.pass.maxZ) / 2;
    const housing = throwAt([1, STAND, 2.6], [1, 2.24, cz - 0.18]);
    expect(housing.contact[2]).toBeCloseTo(cz - 0.18, 2);
    const under = throwAt([0.75, STAND, 5.6], [0.75, 2.18, cz]);
    expect(under.contact[1]).toBeCloseTo(2.18, 2);
    const lamp = throwAt([0, STAND, 5.6], [0, 2.1, cz + 0.098]);
    expect(distance(lamp.contact, [0, 2.1, cz + 0.098])).toBeLessThan(0.01);
    const rim: Point = [0, HEAT_LAMP_HOUSING_Y - 0.15, cz];
    expect(inShadeWall(HEAT_LAMP_SHADE, rim, lamp.tip)).toBe(true);
    const post = throwAt([-4.3, STAND, 2.6], [-4.3, 1.5, cz - 0.028]);
    expect(distance(post.contact, [-4.3, 1.5, cz - 0.028])).toBeLessThan(0.01);
  });

  it('never sink out of the far side of a thin shelf', () => {
    // Straight down onto the top shelf of the sheet-pan rack, 1.2 cm of steel.
    const shelf = 0.22 + 11 * 0.13;
    const hit = throwFrom(-7.7, 2.4, -1.6, NORTH, DOWN);
    expect(hit?.kind === 'surface' && hit.y).toBeGreaterThan(shelf);
    expect(hit?.kind === 'surface' && hit.y).toBeLessThan(shelf + 0.012);
  });

  it('stick into an oval pan where its side is', () => {
    // The fish kettle on the poissonnier's burner is 32 cm long and 13 cm across.
    const target: Point = [3.15, 1.06, -0.65 + 0.32 * 0.42];
    const kettle = throwAt([3.15, STAND, 2.6], target);
    expect(distance(kettle.contact, target)).toBeLessThan(0.01);
  });

  it('fly into the window strip and stick in the glass, set back in the wall', () => {
    const glass = -ROOM_HALF_Z - WINDOW_GLASS_DEPTH;
    const window = throwAt([2, STAND, -5.3], [2, 2, glass]);
    expect(window.contact[2]).toBeCloseTo(glass, 3);
    // Beside the strip, the wall is where it always was.
    const wall = throwAt([WINDOWS.to + 0.6, STAND, -5.3], [WINDOWS.to + 0.6, 2, -ROOM_HALF_Z]);
    expect(wall.contact[2]).toBeCloseTo(-ROOM_HALF_Z, 3);
  });

  it('fly up a skylight and stick in its glass or a glazing bar', () => {
    const { a, b, out } = SKYLIGHT_WELLS[0]!;
    const middle = (depth: number, x: number): Point => [
      x,
      (a.y + b.y) / 2 + depth * out.y,
      (a.z + b.z) / 2 + depth * out.z,
    ];
    const glass = middle(SKYLIGHTS.glass, 1);
    expect(distance(throwAt([1, STAND, -2.6], glass).contact, glass)).toBeLessThan(0.005);
    // The bar at x = 0 is 5 cm square, its middle 3 cm under the glass.
    const bar = middle(SKYLIGHTS.barDepth - SKYLIGHTS.bar / 2, 0);
    expect(distance(throwAt([0, STAND, -2.6], bar).contact, bar)).toBeLessThan(0.005);
  });

  it('keep every solid inside the room and round solids convex, as the flight assumes', () => {
    for (const solid of KNIFE_SOLIDS) {
      expect(solid.minX).toBeLessThanOrEqual(solid.maxX);
      expect(solid.minZ).toBeLessThanOrEqual(solid.maxZ);
      expect(solid.bottom).toBeLessThan(solid.top);
      if (solid.kind !== 'round') continue;
      for (const rings of solid.hollow ? [solid.rings, solid.hollow] : [solid.rings]) {
        for (let i = 1; i + 1 < rings.length; i++) {
          const [[r0, y0], [r1, y1], [r2, y2]] = [rings[i - 1]!, rings[i]!, rings[i + 1]!];
          // Each turn up the outline bends in toward the axis (or goes straight on).
          expect((r1 - r0) * (y2 - y1) - (y1 - y0) * (r2 - r1)).toBeGreaterThanOrEqual(-1e-12);
        }
      }
      if (solid.hollow) expect(solid.hollow[0]![1]).toBe(solid.rings[0]![1]);
    }
  });
});
