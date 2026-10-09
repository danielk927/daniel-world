import {
  BufferGeometry,
  ExtrudeGeometry,
  Float32BufferAttribute,
  PlaneGeometry,
  Shape,
  Vector3,
} from 'three';
import {
  COUNTER_HEIGHT,
  DOORS,
  ISLAND_SHELVES,
  KITCHEN,
  PENDANT_LAMPS,
  PENDANT_SHADE,
  ROOM_HALF_X,
  ROOM_HALF_Z,
  ROOM_HEIGHT,
  SHELVING_SHELVES,
  SKYLIGHTS,
  SKYLIGHT_WELLS,
  STACKED,
  VAULT_FACETS,
  VAULT_RISE,
  vaultHeight,
  WINDOWS,
  WINDOW_GLASS_DEPTH,
  islandStacks,
  shelvingBins,
  type Fixture,
  type Wall,
} from '@world/shared';
import { at } from './builder.ts';
import { buildCooler } from './coolerRoom.ts';
import { paint, shadeGeometry, type Kit, type LayerName } from './kit.ts';

/**
 * The room after the kitchen at the French Laundry: white tiled walls under a white barrel vault
 * with skylights, a pale stone floor, a stainless cooking suite with brass trim under a big hood,
 * charcoal-topped islands, and a long marble-topped counter under a strip of garden windows.
 *
 * Every face that a knife can meet stays within a centimeter or two of the knife solids in the
 * shared layout (`knifeSolids.test.ts`): edges round inward from the solids' boxes, panels and trim
 * stand a centimeter or so proud of them, and wire, rods and knobs let knives through.
 */

const HX = ROOM_HALF_X;
const HZ = ROOM_HALF_Z;
const TOP = COUNTER_HEIGHT;
/** Counters are a body under a 6 cm work surface. */
const SLAB = 0.06;
const VAULT_RADIUS = (HZ * HZ + VAULT_RISE * VAULT_RISE) / (2 * VAULT_RISE);
const VAULT_SWEEP = Math.asin(HZ / VAULT_RADIUS);
/** The vault's arc is drawn this many steps to each of its facets, smooth-shaded. */
const VAULT_STEPS = 4;

/** Finishes: roughness multipliers on layers that take one. */
const POLISHED = 0.55;
const SATIN = 1.25;
/** Wire is too thin to keep a sharp highlight from glittering: dull it. */
const WIRE = 1.9;

/** Dark bronze anodized aluminium, for the window frames. */
const BRONZE = '#3a3532';
/** Black: plinths, knobs, gaskets. */
const BLACK = '#1d1b1a';

interface Opening {
  readonly from: number;
  readonly to: number;
  readonly bottom: number;
  readonly top: number;
}

interface WallSpec {
  /** Wall plane: z for north and south, x for east and west. */
  readonly plane: number;
  readonly axis: 'x' | 'z';
  readonly from: number;
  readonly to: number;
  /** Points into the room. */
  readonly normal: Vector3;
  readonly openings: readonly Opening[];
}

const WALLS: Record<Wall, WallSpec> = {
  north: {
    plane: -HZ,
    axis: 'x',
    from: -HX,
    to: HX,
    normal: new Vector3(0, 0, 1),
    openings: [{ from: WINDOWS.from, to: WINDOWS.to, bottom: WINDOWS.bottom, top: WINDOWS.top }],
  },
  south: { plane: HZ, axis: 'x', from: -HX, to: HX, normal: new Vector3(0, 0, -1), openings: [] },
  east: {
    plane: HX,
    axis: 'z',
    from: -HZ,
    to: HZ,
    normal: new Vector3(-1, 0, 0),
    // The walk-in's doorway, filled by its door (see cooler.ts).
    openings: [
      { from: DOORS.walkIn.from, to: DOORS.walkIn.to, bottom: 0, top: DOORS.walkIn.height },
    ],
  },
  west: { plane: -HX, axis: 'z', from: -HZ, to: HZ, normal: new Vector3(1, 0, 0), openings: [] },
};

/** A point in a wall's own frame: `u` along the wall, `y` up, `d` out from the wall into the room. */
function wallPoint(wall: WallSpec, u: number, y: number, d: number): Vector3 {
  const inward = wall.axis === 'x' ? wall.normal.z : wall.normal.x;
  const p = wall.plane + inward * d;
  return wall.axis === 'x' ? new Vector3(u, y, p) : new Vector3(p, y, u);
}

/** The extents of a box placed in a wall's own frame. */
function wallExtents(
  wall: WallSpec,
  u0: number,
  u1: number,
  y0: number,
  y1: number,
  d0: number,
  d1: number,
): [number, number, number, number, number, number] {
  const a = wallPoint(wall, u0, y0, d0);
  const b = wallPoint(wall, u1, y1, d1);
  return [Math.min(a.x, b.x), Math.max(a.x, b.x), y0, y1, Math.min(a.z, b.z), Math.max(a.z, b.z)];
}

/** A box placed in a wall's own frame. */
function wallBox(
  kit: Kit,
  layer: LayerName,
  wall: WallSpec,
  u0: number,
  u1: number,
  y0: number,
  y1: number,
  d0: number,
  d1: number,
  color?: string,
  finish?: number,
): void {
  kit.box(layer, ...wallExtents(wall, u0, u1, y0, y1, d0, d1), color, finish);
}

/** A box with rounded edges, placed in a wall's own frame. */
function wallRounded(
  kit: Kit,
  layer: LayerName,
  wall: WallSpec,
  u0: number,
  u1: number,
  y0: number,
  y1: number,
  d0: number,
  d1: number,
  radius: number,
  color?: string,
  finish?: number,
): void {
  roundedBox(kit, layer, ...wallExtents(wall, u0, u1, y0, y1, d0, d1), radius, color, finish);
}

/** A box by its extents, its edges rounded over `radius`. */
function roundedBox(
  kit: Kit,
  layer: LayerName,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
  radius: number,
  color?: string,
  finish?: number,
): void {
  kit.rounded(
    layer,
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
    maxX - minX,
    maxY - minY,
    maxZ - minZ,
    radius,
    color,
    { finish },
  );
}

/** The flat face of a wall from `y0` to `y1`, leaving holes where the openings are. */
function wallFace(kit: Kit, wall: WallSpec, y0: number, y1: number, color: string): void {
  const cuts = new Set([y0, y1]);
  for (const o of wall.openings) {
    if (o.bottom > y0 && o.bottom < y1) cuts.add(o.bottom);
    if (o.top > y0 && o.top < y1) cuts.add(o.top);
  }
  const ys = [...cuts].sort((a, b) => a - b);
  for (let i = 0; i < ys.length - 1; i++) {
    const ya = ys[i]!;
    const yb = ys[i + 1]!;
    const blocked = wall.openings
      .filter((o) => o.bottom <= ya && o.top >= yb)
      .sort((a, b) => a.from - b.from);
    let start = wall.from;
    const spans: [number, number][] = [];
    for (const o of blocked) {
      if (o.from > start) spans.push([start, o.from]);
      start = Math.max(start, o.to);
    }
    if (start < wall.to) spans.push([start, wall.to]);
    for (const [a, b] of spans) {
      const p0 = wallPoint(wall, a, ya, 0);
      const p1 = wallPoint(wall, b, ya, 0);
      kit.wall('tile', p0.x, p0.z, p1.x, p1.z, ya, yb, wall.normal, color);
    }
  }
}

/** The floor: one surface, its stone tiles and grout painted (see surfaces/recipes.ts). */
function createFloor(kit: Kit): void {
  kit.flat('floor', -HX, HX, -HZ, HZ, 0, true, paint.floor);
}

/** The skylights' openings in the vault, each as its four corners. */
export const SKYLIGHT_OPENINGS: readonly (readonly Vector3[])[] = SKYLIGHT_WELLS.map(({ a, b }) => {
  const h = SKYLIGHTS.halfLength;
  return [
    new Vector3(-h, a.y, a.z),
    new Vector3(h, a.y, a.z),
    new Vector3(h, b.y, b.z),
    new Vector3(-h, b.y, b.z),
  ];
});

/** A point on the vault's arc, `t` of the way through facet `facet`, and the way in from it. */
function arcPoint(facet: number, t: number): { z: number; y: number; nz: number; ny: number } {
  const angle = -VAULT_SWEEP + ((facet + t) / VAULT_FACETS) * VAULT_SWEEP * 2;
  const z = facet + t <= 0 ? -HZ : facet + t >= VAULT_FACETS ? HZ : VAULT_RADIUS * Math.sin(angle);
  return { z, y: vaultHeight(z), nz: -Math.sin(angle), ny: -Math.cos(angle) };
}

/** One facet of the vault from x0 to x1: a strip of the true arc, smooth-shaded, facing down into the room. */
function vaultStrip(kit: Kit, facet: number, x0: number, x1: number): void {
  const positions: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  for (let k = 0; k <= VAULT_STEPS; k++) {
    const p = arcPoint(facet, k / VAULT_STEPS);
    positions.push(x0, p.y, p.z, x1, p.y, p.z);
    normals.push(0, p.ny, p.nz, 0, p.ny, p.nz);
    if (k > 0) {
      const a = (k - 1) * 2;
      // Wound to face down, into the room.
      index.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setIndex(index);
  kit.add('shell', geometry, undefined, paint.vault);
}

/**
 * White tiled walls on a dark skirting, and the barrel vault in white plaster with its skylights
 * and light lines. The vault is a true arc; its 12 facets, the knife solid, never stray from it by
 * more than 1.3 cm.
 */
function createShell(kit: Kit): void {
  createFloor(kit);
  for (const wall of Object.values(WALLS)) {
    wallFace(kit, wall, 0, ROOM_HEIGHT, paint.wall);
    // The skirting runs along the floor, round any doorway: a dark tile base with a rounded top.
    let start = wall.from;
    for (const o of [...wall.openings]
      .filter((o) => o.bottom === 0)
      .sort((a, b) => a.from - b.from)) {
      wallRounded(kit, 'gloss', wall, start, o.from, 0, 0.1, 0, 0.02, 0.006, paint.seam, 2.6);
      start = o.to;
    }
    wallRounded(kit, 'gloss', wall, start, wall.to, 0, 0.1, 0, 0.02, 0.006, paint.seam, 2.6);
  }

  const h = SKYLIGHTS.halfLength;
  for (let i = 0; i < VAULT_FACETS; i++) {
    // Skylight facets leave the middle open.
    if ((SKYLIGHTS.facets as readonly number[]).includes(i)) {
      vaultStrip(kit, i, -HX, -h);
      vaultStrip(kit, i, h, HX);
    } else {
      vaultStrip(kit, i, -HX, HX);
    }
    // The end walls rise into the vault's arch, in plaster above the tiles.
    for (const wall of [WALLS.east, WALLS.west]) {
      for (let k = 0; k < VAULT_STEPS; k++) {
        const a = arcPoint(i, k / VAULT_STEPS);
        const b = arcPoint(i, (k + 1) / VAULT_STEPS);
        kit.quad(
          'shell',
          [
            new Vector3(wall.plane, ROOM_HEIGHT, a.z),
            new Vector3(wall.plane, ROOM_HEIGHT, b.z),
            new Vector3(wall.plane, b.y, b.z),
            new Vector3(wall.plane, a.y, a.z),
          ],
          wall.normal,
          paint.vault,
        );
      }
    }
  }
  // Skylights: two long strips open to the evening sky over the aisles, either side of the hood,
  // each a shallow well through the vault with night glass and glazing bars at the top.
  SKYLIGHT_WELLS.forEach(({ a, b, out: o }, w) => {
    const facet = SKYLIGHTS.facets[w]!;
    const out = new Vector3(0, o.y, o.z);
    const lift = (p: Vector3, depth: number) => p.clone().addScaledVector(out, depth);
    const [a0, a1] = [new Vector3(-h, a.y, a.z), new Vector3(h, a.y, a.z)];
    const [b0, b1] = [new Vector3(-h, b.y, b.z), new Vector3(h, b.y, b.z)];
    const across = new Vector3(0, b.y - a.y, b.z - a.z).normalize();
    const well = SKYLIGHTS.depth;
    kit.quad('shell', [a0, a1, lift(a1, well), lift(a0, well)], across, paint.vault);
    kit.quad(
      'shell',
      [b0, b1, lift(b1, well), lift(b0, well)],
      across.clone().negate(),
      paint.vault,
    );
    // The well's ends follow the arc they are cut from, so no sliver of sky shows beside them.
    for (const [x, facing] of [
      [-h, new Vector3(1, 0, 0)],
      [h, new Vector3(-1, 0, 0)],
    ] as const) {
      for (let k = 0; k < VAULT_STEPS; k++) {
        const p = arcPoint(facet, k / VAULT_STEPS);
        const q = arcPoint(facet, (k + 1) / VAULT_STEPS);
        const lower = new Vector3(x, p.y, p.z);
        const upper = new Vector3(x, q.y, q.z);
        kit.quad(
          'shell',
          [lower, upper, lift(upper, well), lift(lower, well)],
          facing,
          paint.vault,
        );
      }
    }
    const glass = SKYLIGHTS.glass;
    const pane = [lift(a0, glass), lift(a1, glass), lift(b1, glass), lift(b0, glass)];
    kit.quad('window', pane, out.clone().negate());
    kit.quad(
      'pane',
      pane.map((p) => p.clone().addScaledVector(out, -0.002)),
      out.clone().negate(),
    );
    const mid = lift(a0.clone().add(b1).multiplyScalar(0.5), SKYLIGHTS.barDepth);
    const length = a0.distanceTo(b0);
    const rx = Math.atan2(-(b.y - a.y), b.z - a.z);
    const bar = SKYLIGHTS.bar;
    for (let k = 1; k < SKYLIGHTS.panes; k++) {
      const x = -h + (2 * h * k) / SKYLIGHTS.panes;
      // On the shell, which casts no shadow: the overhead light sits above the ceiling.
      kit.rounded('shell', x, mid.y, mid.z, bar, bar, length, 0.006, BRONZE, { rx });
    }
  });
  // Light lines where the vault springs from the long walls, in a slim steel channel.
  for (const wall of [WALLS.north, WALLS.south]) {
    wallBox(
      kit,
      'light',
      wall,
      -HX,
      HX,
      ROOM_HEIGHT - 0.055,
      ROOM_HEIGHT - 0.025,
      0,
      0.045,
      paint.lamp,
    );
    wallRounded(
      kit,
      'steel',
      wall,
      -HX,
      HX,
      ROOM_HEIGHT - 0.06,
      ROOM_HEIGHT - 0.052,
      0,
      0.05,
      0.003,
    );
  }
}

/** The strip of garden windows in the north wall: dark bronze frames, a marble sill, night glass. */
function createWindows(kit: Kit): void {
  const wall = WALLS.north;
  const { from, to, bottom, top, panes } = WINDOWS;
  const depth = 0.25;
  // Reveals: the thickness of the wall around the opening, in plaster, on a marble sill.
  kit.flat('shell', from, to, -HZ - depth, -HZ, top, false, paint.wall);
  // The sill: a marble slab through the reveal, its front just proud of the splash under it.
  roundedBox(
    kit,
    'stone',
    from - 0.02,
    to + 0.02,
    bottom - 0.012,
    bottom + 0.012,
    -HZ - depth,
    -HZ + 0.025,
    0.006,
    paint.marble,
    0.75,
  );
  kit.wall('shell', from, -HZ - depth, from, -HZ, bottom, top, new Vector3(1, 0, 0), paint.wall);
  kit.wall('shell', to, -HZ - depth, to, -HZ, bottom, top, new Vector3(-1, 0, 0), paint.wall);
  const frame = -0.12;
  const bar = 0.05;
  wallRounded(
    kit,
    'steel',
    wall,
    from,
    to,
    top - bar,
    top,
    frame - 0.03,
    frame,
    0.005,
    BRONZE,
    SATIN,
  );
  wallRounded(
    kit,
    'steel',
    wall,
    from,
    to,
    bottom,
    bottom + bar,
    frame - 0.03,
    frame,
    0.005,
    BRONZE,
    SATIN,
  );
  for (let i = 0; i <= panes; i++) {
    const u = from + ((to - from) * i) / panes;
    wallRounded(
      kit,
      'steel',
      wall,
      u - bar / 2,
      u + bar / 2,
      bottom,
      top,
      frame - 0.03,
      frame,
      0.005,
      BRONZE,
      SATIN,
    );
  }
  const glass = new PlaneGeometry(to - from, top - bottom);
  kit.add('window', glass, at((from + to) / 2, (top + bottom) / 2, -HZ - WINDOW_GLASS_DEPTH));
  kit.add('pane', glass, at((from + to) / 2, (top + bottom) / 2, -HZ - WINDOW_GLASS_DEPTH + 0.002));
  // Every Second Counts: The Bear's nameplate, on the wall over the windows. From the pass, the
  // line of sight runs under the hood straight to it. A navy enamel plate between two black rails.
  const signY = (top + ROOM_HEIGHT - 0.08) / 2;
  kit.rounded('gloss', 0, signY, -HZ + 0.0055, 2.2, 0.5, 0.011, 0.004, '#1b2150', { finish: 2 });
  kit.add('sign', new PlaneGeometry(2.17, 0.47), at(0, signY, -HZ + 0.0115));
  for (const side of [-1, 1]) {
    const y = signY + side * 0.265;
    roundedBox(kit, 'iron', -1.13, 1.13, y - 0.022, y + 0.022, -HZ, -HZ + 0.03, 0.006, BLACK);
  }
}

/** The steel lintel over the dining room doors, which the clock above them sits clear of. */
const DOOR_LINTEL = 0.12;

function createDoors(kit: Kit): void {
  // Swinging doors to the dining room, in a steel frame, with warm light through their portholes.
  const dining = DOORS.dining;
  const south = WALLS[dining.wall];
  const { from, to, height } = dining;
  wallRounded(
    kit,
    'steel',
    south,
    from - 0.1,
    to + 0.1,
    height,
    height + DOOR_LINTEL,
    0,
    0.06,
    0.008,
  );
  wallRounded(kit, 'steel', south, from - 0.1, from, 0, height, 0, 0.06, 0.008);
  wallRounded(kit, 'steel', south, to, to + 0.1, 0, height, 0, 0.06, 0.008);
  for (const side of [-1, 1]) {
    const u0 = side < 0 ? from : 0.015;
    const u1 = side < 0 ? -0.015 : to;
    const cu = (u0 + u1) / 2;
    wallRounded(kit, 'steel', south, u0, u1, 0.03, height - 0.02, 0.01, 0.045, 0.01);
    // A kick plate, scuffed duller than the door.
    wallRounded(
      kit,
      'steel',
      south,
      u0 + 0.03,
      u1 - 0.03,
      0.06,
      0.34,
      0.045,
      0.05,
      0.003,
      '#c9c9c7',
      1.6,
    );
    // The porthole: a black rubber gasket round glass lit by the dining room.
    kit.add('iron', kit.torus(0.17, 0.022), at(cu, 1.55, HZ - 0.05), BLACK, {
      uv: 'own',
      finish: 1.4,
    });
    const porthole = kit.disc(0.16);
    kit.add('light', porthole, at(cu, 1.55, HZ - 0.047, { ry: Math.PI }), paint.porthole);
    kit.add('pane', porthole, at(cu, 1.55, HZ - 0.049, { ry: Math.PI }));
    // A push plate where the hand goes.
    const hu = side < 0 ? u1 - 0.09 : u0 + 0.09;
    wallRounded(
      kit,
      'steel',
      south,
      hu - 0.05,
      hu + 0.05,
      0.95,
      1.3,
      0.045,
      0.05,
      0.003,
      undefined,
      POLISHED,
    );
  }

  // The walk-in cooler, a heavy steel door in a steel frame: see coolerRoom.ts and cooler.ts.
  buildCooler(kit);

  // Back door, a painted steel door with a push bar, the exit sign above it.
  const back = DOORS.back;
  const west = WALLS[back.wall];
  wallRounded(
    kit,
    'steel',
    west,
    back.from - 0.08,
    back.to + 0.08,
    0,
    back.height + 0.08,
    0,
    0.04,
    0.006,
  );
  wallRounded(
    kit,
    'gloss',
    west,
    back.from,
    back.to,
    0.02,
    back.height,
    0.04,
    0.08,
    0.006,
    '#4c524f',
    3.2,
  );
  kit.rod(
    'steel',
    wallPoint(west, back.from + 0.15, 1.02, 0.16),
    wallPoint(west, back.to - 0.15, 1.02, 0.16),
    0.022,
    undefined,
    undefined,
    POLISHED,
  );
  for (const u of [back.from + 0.18, back.to - 0.18]) {
    wallRounded(kit, 'steel', west, u - 0.025, u + 0.025, 0.98, 1.06, 0.08, 0.16, 0.008);
  }
  const signU = (back.from + back.to) / 2;
  const signY = back.height + 0.32;
  wallRounded(
    kit,
    'gloss',
    west,
    signU - 0.28,
    signU + 0.28,
    signY - 0.11,
    signY + 0.11,
    0,
    0.08,
    0.01,
    BLACK,
    2,
  );
  const sign = wallPoint(west, signU, signY, 0.081);
  kit.add('exit', new PlaneGeometry(0.5, 0.18), at(sign.x, sign.y, sign.z, { ry: Math.PI / 2 }));
}

/** How a counter is dressed: its work surface, and its body and doors. */
interface CounterLook {
  readonly top: LayerName;
  readonly topColor?: string;
  readonly topFinish?: number;
  readonly body: LayerName;
  readonly bodyColor?: string;
}

/**
 * A counter: a body on a recessed black plinth, under a work surface that overhangs it a little,
 * its edges eased.
 */
function counter(kit: Kit, f: Fixture, look: CounterLook): void {
  const inset = 0.05;
  roundedBox(
    kit,
    'iron',
    f.minX + inset,
    f.maxX - inset,
    0,
    0.1,
    f.minZ + inset,
    f.maxZ - inset,
    0.004,
    BLACK,
  );
  roundedBox(
    kit,
    look.body,
    f.minX,
    f.maxX,
    0.1,
    TOP - SLAB,
    f.minZ,
    f.maxZ,
    0.006,
    look.bodyColor,
  );
  roundedBox(
    kit,
    look.top,
    f.minX - 0.02,
    f.maxX + 0.02,
    TOP - SLAB,
    TOP,
    f.minZ - 0.02,
    f.maxZ + 0.02,
    0.008,
    look.topColor,
    look.topFinish,
  );
}

/** Doors along one long face of a counter: panels with a hairline between them and a bar pull each. */
function cabinetFront(
  kit: Kit,
  f: Fixture,
  face: 'north' | 'south',
  doors: number,
  layer: LayerName,
  color?: string,
  finish?: number,
): void {
  const outward = face === 'north' ? -1 : 1;
  const z = face === 'north' ? f.minZ : f.maxZ;
  const width = (f.maxX - f.minX) / doors;
  const [z0, z1] = [Math.min(z, z + outward * 0.012), Math.max(z, z + outward * 0.012)];
  for (let i = 0; i < doors; i++) {
    const a = f.minX + i * width;
    roundedBox(
      kit,
      layer,
      a + 0.003,
      a + width - 0.003,
      0.13,
      TOP - SLAB - 0.02,
      z0,
      z1,
      0.004,
      color,
      finish,
    );
    const x = a + width / 2;
    const pull = z + outward * 0.04;
    const half = width * 0.22;
    kit.rod(
      'steel',
      new Vector3(x - half, TOP - SLAB - 0.09, pull),
      new Vector3(x + half, TOP - SLAB - 0.09, pull),
      0.007,
      undefined,
      undefined,
      POLISHED,
    );
    for (const end of [-half + 0.01, half - 0.01]) {
      kit.rod(
        'steel',
        new Vector3(x + end, TOP - SLAB - 0.09, z + outward * 0.012),
        new Vector3(x + end, TOP - SLAB - 0.09, pull),
        0.005,
        undefined,
        undefined,
        POLISHED,
      );
    }
  }
}

/**
 * The stainless cooking suite, after the French ranges it stands for: a thick top with a rounded
 * edge, a brass band under it carrying rows of black knobs, brushed oven doors on brass rails, a
 * towel rail, and a high shelf down its spine.
 */
function createPiano(kit: Kit): void {
  const p = KITCHEN.piano;
  roundedBox(
    kit,
    'iron',
    p.minX + 0.06,
    p.maxX - 0.06,
    0,
    0.12,
    p.minZ + 0.06,
    p.maxZ - 0.06,
    0.004,
    BLACK,
  );
  roundedBox(kit, 'steel', p.minX, p.maxX, 0.12, TOP - SLAB - 0.04, p.minZ, p.maxZ, 0.012);
  roundedBox(
    kit,
    'steel',
    p.minX - 0.04,
    p.maxX + 0.04,
    TOP - SLAB - 0.04,
    TOP,
    p.minZ - 0.04,
    p.maxZ + 0.04,
    0.02,
    undefined,
    0.85,
  );
  const knob = knobProfile();
  for (const side of [-1, 1]) {
    const face = side * p.maxZ;
    // The brass band under the top, and the knobs on it.
    kit.box(
      'brass',
      p.minX + 0.03,
      p.maxX - 0.03,
      0.73,
      0.81,
      face - 0.002 * side,
      face + side * 0.004,
    );
    // Oven doors: brushed panels with full-width brass rails.
    for (const cx of [-3.6, -1.2, 1.2, 3.6]) {
      kit.rounded('steel', cx, 0.45, face + side * 0.012, 2.1, 0.5, 0.03, 0.01, undefined, {
        finish: 0.9,
      });
      kit.rod(
        'brass',
        new Vector3(cx - 0.8, 0.64, face + side * 0.07),
        new Vector3(cx + 0.8, 0.64, face + side * 0.07),
        0.012,
      );
      for (const dx of [-0.8, 0.8]) {
        kit.rod(
          'brass',
          new Vector3(cx + dx, 0.64, face + side * 0.027),
          new Vector3(cx + dx, 0.64, face + side * 0.07),
          0.009,
        );
      }
    }
    for (let i = 0; i < 16; i++) {
      const x = p.minX + 0.5 + i * ((p.maxX - p.minX - 1) / 15);
      const z = face + side * 0.004;
      kit.lathe('gloss', x, 0.77, z, knob, { rx: (side * Math.PI) / 2, color: BLACK, finish: 1.6 });
      kit.add('brass', kit.torus(0.028, 0.0035), at(x, 0.77, z + side * 0.002), undefined, {
        uv: 'own',
      });
    }
    // Towel rail along the front edge, on three brackets.
    kit.rod(
      'steel',
      new Vector3(p.minX + 0.1, 0.8, face + side * 0.11),
      new Vector3(p.maxX - 0.1, 0.8, face + side * 0.11),
      0.014,
      undefined,
      undefined,
      POLISHED,
    );
    for (const x of [p.minX + 0.12, 0, p.maxX - 0.12]) {
      kit.rod(
        'steel',
        new Vector3(x, 0.8, face),
        new Vector3(x, 0.8, face + side * 0.11),
        0.011,
        undefined,
        undefined,
        POLISHED,
      );
    }
  }

  // Cast iron cooking zones on the steel top.
  for (const zSide of [-1, 1]) {
    for (const xSide of [-1, 1]) {
      const [x0, x1] = [Math.min(xSide * 1.55, xSide * 3.65), Math.max(xSide * 1.55, xSide * 3.65)];
      const [z0, z1] = [Math.min(zSide * 0.12, zSide * 1.3), Math.max(zSide * 0.12, zSide * 1.3)];
      roundedBox(kit, 'iron', x0, x1, TOP - 0.004, TOP + 0.01, z0, z1, 0.004, '#2f2c2a');
    }
  }
  roundedBox(kit, 'iron', -1.35, 1.35, TOP - 0.004, TOP + 0.01, -1.3, 1.3, 0.004, '#2f2c2a');

  // The high shelf down the middle, where plates and squeeze bottles wait within reach.
  kit.rounded('steel', 0, 1.515, 0, 8.4, 0.03, 0.4, 0.008);
  for (const x of [-4.1, -1.6, 1.6, 4.1]) kit.cylinder('steel', x, TOP, 0, 0.019, 1.5 - TOP);
  for (const [x, count] of [
    [-3.4, 7],
    [3.3, 5],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const profile = i === count - 1 ? plateProfile(0.14, 0.014) : stackedPlate(0.14, 0.014);
      kit.lathe('gloss', x, 1.53 + i * 0.018, 0, profile, {
        color: paint.porcelain,
        finish: 0.5,
        segments: 32,
      });
    }
  }
  for (const [x, color] of [
    [-0.4, '#f4f1ea'],
    [-0.25, '#c0392b'],
    [-0.1, '#f2c94c'],
    [0.6, '#f4f1ea'],
  ] as const) {
    kit.lathe('gloss', x, 1.53, 0.05, squeezeBottle(), { color, finish: 2.4 });
  }
}

/** A range's control knob, turned: a skirt, a waisted grip and a domed cap, along +y. */
function knobProfile(): [number, number][] {
  return [
    [0.001, 0],
    [0.024, 0],
    [0.024, 0.006],
    [0.021, 0.01],
    [0.017, 0.016],
    [0.016, 0.032],
    [0.014, 0.04],
    [0.008, 0.044],
    [0.001, 0.045],
  ];
}

/** A plate turned in section: a foot, the well, and a rim that lifts, `radius` across and `height` deep. */
export function plateProfile(radius: number, height: number): [number, number][] {
  return [
    [0.001, 0.002],
    [radius * 0.45, 0.002],
    [radius * 0.48, 0],
    [radius * 0.55, 0],
    [radius * 0.58, height * 0.25],
    [radius * 0.72, height * 0.3],
    [radius * 0.92, height * 0.75],
    [radius, height],
    [radius * 0.985, height * 1.05],
    [radius * 0.9, height * 0.82],
    [radius * 0.7, height * 0.55],
    [radius * 0.62, height * 0.5],
    [0.001, height * 0.5],
  ];
}

/** A plate under others in a stack: only its foot and rim show, so only they are turned. */
export function stackedPlate(radius: number, height: number): [number, number][] {
  return [
    [0.001, 0],
    [radius * 0.55, 0],
    [radius * 0.92, height * 0.75],
    [radius, height],
    [0.001, height],
  ];
}

/** A squeeze bottle: a soft body, a shoulder, a cap and a nozzle. */
function squeezeBottle(): [number, number][] {
  return [
    [0.001, 0],
    [0.028, 0],
    [0.03, 0.006],
    [0.03, 0.15],
    [0.026, 0.168],
    [0.016, 0.175],
    [0.016, 0.19],
    [0.008, 0.196],
    [0.003, 0.215],
    [0.001, 0.216],
  ];
}

/**
 * The hood: a steel skirt round an underside of steel baffle filters and recessed lights, boxed up
 * into the vault in white plaster, with three Michelin stars on its north face.
 */
function createHood(kit: Kit): void {
  const h = KITCHEN.hood;
  const skirtTop = h.top - 0.05;
  const t = 0.04;
  roundedBox(kit, 'steel', h.minX, h.maxX, h.bottom, skirtTop, h.minZ, h.minZ + t, 0.008);
  roundedBox(kit, 'steel', h.minX, h.maxX, h.bottom, skirtTop, h.maxZ - t, h.maxZ, 0.008);
  roundedBox(kit, 'steel', h.minX, h.minX + t, h.bottom, skirtTop, h.minZ + t, h.maxZ - t, 0.008);
  roundedBox(kit, 'steel', h.maxX - t, h.maxX, h.bottom, skirtTop, h.minZ + t, h.maxZ - t, 0.008);
  const ceiling = skirtTop - 0.002;
  const cell = 0.6;
  const filter = new PlaneGeometry(0.58, 0.58);
  const corners = filter.getAttribute('uv');
  for (let i = 0; i < corners.count; i++)
    corners.setXY(i, corners.getX(i) * 0.58, corners.getY(i) * 0.58);
  for (let x = h.minX + t + 0.03; x + cell <= h.maxX - t; x += cell) {
    for (let z = h.minZ + t + 0.08; z + cell <= h.maxZ - t; z += cell) {
      // A baffle filter, its folds painted (see surfaces/recipes.ts), from corner to corner of
      // its own texture.
      kit.add(
        'baffle',
        filter,
        at(x + cell / 2, ceiling - 0.004, z + cell / 2, { rx: Math.PI / 2 }),
        undefined,
        {
          uv: 'own',
        },
      );
    }
  }
  for (let i = 0; i < 6; i++) {
    for (const z of [-0.95, 0.95]) {
      const x = -4 + i * 1.6;
      kit.add('light', kit.disc(0.09), at(x, ceiling - 0.024, z, { rx: Math.PI / 2 }), paint.lamp);
      kit.add(
        'steel',
        kit.torus(0.1, 0.008),
        at(x, ceiling - 0.024, z, { rx: Math.PI / 2 }),
        undefined,
        { uv: 'own', finish: POLISHED },
      );
    }
  }
  kit.box('shell', h.minX, h.maxX, skirtTop, vaultHeight(0) + 0.05, h.minZ, h.maxZ, paint.vault);

  // Three Michelin stars on the hood's north face, as at the French Laundry: brass on enamel.
  const star = new Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 0.125 : 0.052;
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const starGeometry = new ExtrudeGeometry(star, {
    depth: 0.01,
    bevelEnabled: true,
    bevelThickness: 0.003,
    bevelSize: 0.003,
    bevelSegments: 2,
  });
  // High on the fascia, above the skirt, where they face the islands.
  const plaqueY = 4.0;
  for (const x of [-0.75, 0, 0.75]) {
    kit.rounded('gloss', x, plaqueY, h.minZ - 0.015, 0.42, 0.42, 0.03, 0.006, paint.plaque, {
      finish: 0.9,
    });
    kit.add('brass', starGeometry, at(x, plaqueY, h.minZ - 0.033, { ry: Math.PI }), undefined, {
      finish: POLISHED,
    });
  }
}

/** The LED clock's display, in meters: four times as wide as it is tall, like its face. */
export const CLOCK_SIZE = { width: 1.36, height: 0.34 } as const;
/** The clock's black housing: a margin round the display, and how far it stands off the wall. */
const CLOCK_HOUSING = { width: CLOCK_SIZE.width + 0.14, height: CLOCK_SIZE.height + 0.13 };
const CLOCK_DEPTH = 0.06;

/**
 * Where the kitchen clock's face is: flat on the south wall, centered over the dining room doors a
 * little above their frame and well under the light line, facing into the kitchen. From the
 * islands and the windows it shows between the hood and the heat lamps over the pass.
 * KitchenClock draws it.
 */
export const CLOCK_DISPLAY = {
  x: (DOORS.dining.from + DOORS.dining.to) / 2,
  y: DOORS.dining.height + DOOR_LINTEL + 0.22 + CLOCK_HOUSING.height / 2,
  // Just proud of the housing's front.
  z: HZ - CLOCK_DEPTH - 0.003,
  ry: Math.PI,
} as const;

/** The clock's black housing; the face itself is KitchenClock's. */
function createClockHousing(kit: Kit): void {
  const { x, y } = CLOCK_DISPLAY;
  const { width, height } = CLOCK_HOUSING;
  wallRounded(
    kit,
    'gloss',
    WALLS.south,
    x - width / 2,
    x + width / 2,
    y - height / 2,
    y + height / 2,
    0,
    CLOCK_DEPTH,
    0.012,
    '#151414',
    2.4,
  );
}

/** A charcoal-topped prep island on a steel frame of round legs, plates stacked on its open shelves. */
function island(kit: Kit, f: Fixture): void {
  roundedBox(
    kit,
    'stone',
    f.minX - 0.04,
    f.maxX + 0.04,
    TOP - SLAB,
    TOP,
    f.minZ - 0.04,
    f.maxZ + 0.04,
    0.012,
    paint.charcoal,
  );
  roundedBox(
    kit,
    'steel',
    f.minX + 0.03,
    f.maxX - 0.03,
    TOP - SLAB - 0.08,
    TOP - SLAB,
    f.minZ + 0.03,
    f.maxZ - 0.03,
    0.004,
  );
  for (const y of ISLAND_SHELVES) {
    roundedBox(
      kit,
      'steel',
      f.minX + 0.05,
      f.maxX - 0.05,
      y,
      y + 0.025,
      f.minZ + 0.05,
      f.maxZ - 0.05,
      0.005,
      undefined,
      SATIN,
    );
  }
  for (const x of [f.minX + 0.06, f.maxX - 0.06]) {
    for (const z of [f.minZ + 0.06, f.maxZ - 0.06]) {
      kit.cylinder('steel', x, 0.06, z, 0.0225, TOP - SLAB - 0.06);
      // An adjustable bullet foot.
      kit.lathe(
        'steel',
        x,
        0,
        z,
        [
          [0.001, 0],
          [0.018, 0],
          [0.022, 0.006],
          [0.024, 0.03],
          [0.0225, 0.06],
          [0.001, 0.06],
        ],
        { finish: POLISHED },
      );
    }
  }
  // A few stacks of white plates and bowls on each shelf.
  for (const { x, y, z, count, bowls } of islandStacks(f)) {
    const { radius, height, step, taper } = bowls ? STACKED.bowl : STACKED.plate;
    for (let i = 0; i < count; i++) {
      // Only the top of a stack shows its well; the rest show their rims.
      const top = i === count - 1;
      const profile = bowls
        ? top
          ? bowlProfile(radius, radius * taper, height)
          : stackedBowl(radius, radius * taper, height)
        : top
          ? plateProfile(radius, height)
          : stackedPlate(radius, height);
      kit.lathe('gloss', x, y + i * step, z, profile, {
        color: paint.porcelain,
        finish: 0.5,
        segments: 28,
      });
    }
  }
}

/** A bowl in section: a foot, flaring walls, a rounded lip and the inside, `top` across at the rim. */
function bowlProfile(bottom: number, top: number, height: number): [number, number][] {
  return [
    [0.001, 0.003],
    [bottom * 0.55, 0.003],
    [bottom * 0.58, 0],
    [bottom * 0.68, 0],
    [bottom * 0.75, height * 0.12],
    [(bottom + top) / 2, height * 0.55],
    [top, height],
    [top * 0.97, height * 1.02],
    [top * 0.93, height * 0.96],
    [(bottom + top) / 2 - 0.006, height * 0.55],
    [bottom * 0.7, height * 0.18],
    [0.001, height * 0.15],
  ];
}

/** A bowl under others in a stack: its outside and lip. */
function stackedBowl(bottom: number, top: number, height: number): [number, number][] {
  return [
    [0.001, 0],
    [bottom * 0.68, 0],
    [(bottom + top) / 2, height * 0.55],
    [top, height],
    [0.001, height],
  ];
}

/** Where the pendant lamps over the two islands hang: a pair along each, by their bulbs. */
export const PENDANTS: readonly Vector3[] = PENDANT_LAMPS.map(
  (p) => new Vector3(p.x, p.y + 0.06, p.z),
);

const PENDANT_DOME_TOP = PENDANT_SHADE.outside[PENDANT_SHADE.outside.length - 1]![1];

/** Brass pendants on long cords from the vault, each with a glowing bulb inside the shade. */
function createPendants(kit: Kit): void {
  const dome = shadeGeometry(PENDANT_SHADE, kit.sides(0.25));
  for (const p of PENDANT_LAMPS) {
    kit.add('brass', dome, at(p.x, p.y, p.z), undefined, { finish: SATIN });
    kit.sphere('light', p.x, p.y + 0.06, p.z, 0.055, { sy: 0.8, color: paint.lamp });
    const rod = p.y + PENDANT_DOME_TOP;
    const ceiling = ceilingOver(p.x, p.z);
    kit.cylinder('brass', p.x, rod - 0.01, p.z, 0.022, 0.03, { taper: 0.6 });
    kit.cylinder('iron', p.x, rod, p.z, 0.004, ceiling - rod, { color: BLACK });
    kit.cylinder('brass', p.x, ceiling - 0.035, p.z, 0.05, 0.035, { taper: 0.8 });
  }
}

/** The height of the ceiling over a point: the vault, or the glass of a skylight's well. */
function ceilingOver(x: number, z: number): number {
  for (const { a, b, out } of SKYLIGHT_WELLS) {
    const glass = { z: a.z + SKYLIGHTS.glass * out.z, y: a.y + SKYLIGHTS.glass * out.y };
    const end = { z: b.z + SKYLIGHTS.glass * out.z, y: b.y + SKYLIGHTS.glass * out.y };
    const t = (z - glass.z) / (end.z - glass.z);
    if (Math.abs(x) <= SKYLIGHTS.halfLength && t >= 0 && t <= 1) {
      return glass.y + t * (end.y - glass.y);
    }
  }
  return vaultHeight(z);
}

/** A sink set into a counter: a steel rim, the basin's shadowed floor and a drain. */
function sink(kit: Kit, cx: number, z0: number, z1: number, halfWidth: number, top: number): void {
  roundedBox(
    kit,
    'steel',
    cx - halfWidth,
    cx + halfWidth,
    top - 0.002,
    top + 0.004,
    z0,
    z0 + 0.03,
    0.002,
    undefined,
    POLISHED,
  );
  roundedBox(
    kit,
    'steel',
    cx - halfWidth,
    cx + halfWidth,
    top - 0.002,
    top + 0.004,
    z1 - 0.03,
    z1,
    0.002,
    undefined,
    POLISHED,
  );
  roundedBox(
    kit,
    'steel',
    cx - halfWidth,
    cx - halfWidth + 0.03,
    top - 0.002,
    top + 0.004,
    z0,
    z1,
    0.002,
    undefined,
    POLISHED,
  );
  roundedBox(
    kit,
    'steel',
    cx + halfWidth - 0.03,
    cx + halfWidth,
    top - 0.002,
    top + 0.004,
    z0,
    z1,
    0.002,
    undefined,
    POLISHED,
  );
  kit.box(
    'steel',
    cx - halfWidth + 0.03,
    cx + halfWidth - 0.03,
    top - 0.004,
    top + 0.001,
    z0 + 0.03,
    z1 - 0.03,
    '#6d6b69',
    1.7,
  );
  kit.cylinder('steel', cx, top + 0.001, (z0 + z1) / 2, 0.035, 0.002, { color: '#3a3836' });
}

function createCounters(kit: Kit): void {
  const { pass, gardeManger, pastryIsland, windowCounter, plonge, fridge, shelving, panRack } =
    KITCHEN;
  counter(kit, pass, { top: 'steel', topFinish: 0.85, body: 'steel' });
  cabinetFront(kit, pass, 'north', 6, 'steel', undefined, 1.05);

  island(kit, gardeManger);
  island(kit, pastryIsland);

  // The window counter: white enamel cabinets under a honed marble top and splash, three sinks with
  // gooseneck taps.
  const w = windowCounter;
  counter(kit, w, {
    top: 'stone',
    topColor: paint.marble,
    topFinish: 0.75,
    body: 'gloss',
    bodyColor: paint.cabinet,
  });
  cabinetFront(kit, w, 'south', 12, 'gloss', paint.cabinet, 1.6);
  roundedBox(
    kit,
    'stone',
    w.minX,
    w.maxX,
    TOP,
    WINDOWS.bottom,
    -HZ,
    -HZ + 0.03,
    0.004,
    paint.marble,
    0.75,
  );
  const neck = kit.torus(0.12, 0.012, Math.PI);
  for (const cx of [-4.5, 0, 4.5]) {
    sink(kit, cx, -6.34, -5.96, 0.42, TOP);
    kit.cylinder('steel', cx, TOP, -6.4, 0.024, 0.03, { finish: POLISHED });
    kit.cylinder('steel', cx, TOP + 0.03, -6.4, 0.014, 0.25, { finish: POLISHED });
    kit.add('steel', neck, at(cx, TOP + 0.28, -6.28, { ry: Math.PI / 2 }), undefined, {
      uv: 'own',
      finish: POLISHED,
    });
    kit.rounded('steel', cx + 0.045, TOP + 0.09, -6.4, 0.07, 0.012, 0.016, 0.005, undefined, {
      finish: POLISHED,
    });
  }

  // Dish pit on the south wall: steel, two sinks, a splash, and a shelf of hotel pans above.
  const d = plonge;
  counter(kit, d, { top: 'steel', topFinish: 0.85, body: 'steel' });
  cabinetFront(kit, d, 'north', 4, 'steel', undefined, 1.05);
  roundedBox(kit, 'steel', d.minX, d.maxX, TOP, 1.38, HZ - 0.03, HZ, 0.004);
  for (const cx of [5.3, 7.2]) sink(kit, cx, 5.95, 6.38, 0.5, TOP);
  roundedBox(kit, 'steel', d.minX, d.maxX, 1.88, 1.92, HZ - 0.42, HZ, 0.006);
  for (let i = 0; i < 5; i++) {
    const x = d.minX + 0.4 + i * 0.65;
    for (let k = 0; k < 3; k++) {
      roundedBox(
        kit,
        'steel',
        x - 0.22,
        x + 0.22,
        1.92 + k * 0.07,
        1.98 + k * 0.07,
        HZ - 0.37,
        HZ - 0.05,
        0.008,
        undefined,
        0.8,
      );
    }
  }

  // Reach-in fridge: lit from inside, behind a glass door facing the room.
  const fr = fridge;
  const front = fr.minX + 0.45;
  roundedBox(kit, 'steel', front, fr.maxX, 0, fr.top, fr.minZ, fr.maxZ, 0.012);
  roundedBox(kit, 'steel', fr.minX, front, 0, 0.2, fr.minZ, fr.maxZ, 0.01);
  roundedBox(kit, 'steel', fr.minX, front, fr.top - 0.2, fr.top, fr.minZ, fr.maxZ, 0.01);
  roundedBox(kit, 'steel', fr.minX, front, 0.2, fr.top - 0.2, fr.minZ, fr.minZ + 0.1, 0.008);
  roundedBox(kit, 'steel', fr.minX, front, 0.2, fr.top - 0.2, fr.maxZ - 0.1, fr.maxZ, 0.008);
  kit.wall(
    'light',
    front - 0.001,
    fr.minZ + 0.1,
    front - 0.001,
    fr.maxZ - 0.1,
    0.2,
    fr.top - 0.2,
    new Vector3(-1, 0, 0),
    // A cool glow from inside; lamps shine past white (see Kit), and this would blow out.
    '#7e9cad',
  );
  const bottleColors = ['#2f5a2a', '#6e1422', '#e8d9a8', '#f2f2f2'];
  for (let shelf = 0; shelf < 3; shelf++) {
    const y = 0.55 + shelf * 0.45;
    roundedBox(
      kit,
      'steel',
      fr.minX + 0.05,
      front,
      y - 0.012,
      y,
      fr.minZ + 0.1,
      fr.maxZ - 0.1,
      0.003,
    );
    for (let i = 0; i < 4; i++) {
      kit.lathe('gloss', fr.minX + 0.25, y, fr.minZ + 0.35 + i * 0.3, bottleProfile(), {
        color: bottleColors[(i + shelf) % bottleColors.length],
        finish: 0.4,
      });
    }
  }
  const door = new PlaneGeometry(fr.maxZ - fr.minZ - 0.2, fr.top - 0.4);
  const doorAt = at(fr.minX + 0.02, fr.top / 2, (fr.minZ + fr.maxZ) / 2, { ry: -Math.PI / 2 });
  kit.add('glass', door, doorAt);
  kit.cylinder('steel', fr.minX - 0.03, 0.75, fr.minZ + 0.18, 0.012, 0.7, { finish: POLISHED });

  // Open storage shelving: wire shelves of clear tubs and deli containers.
  const s = shelving;
  for (const x of [s.minX + 0.02, s.maxX - 0.02]) {
    for (const z of [s.minZ + 0.02, s.maxZ - 0.02]) {
      kit.cylinder('steel', x, 0, z, 0.0127, s.top, { finish: POLISHED });
    }
  }
  const fillings = ['#efe6cf', '#d9b36c', '#b8c98f'];
  const bins = shelvingBins();
  for (const y of SHELVING_SHELVES) {
    wireShelf(kit, s.minX, s.maxX, s.minZ, s.maxZ, y);
    for (const { kind, y: on, z, pick } of bins) {
      if (on !== y) continue;
      if (kind === 'tub') {
        roundedBox(
          kit,
          'glass',
          s.minX + 0.06,
          s.maxX - 0.06,
          y,
          y + 0.28,
          z - 0.18,
          z + 0.18,
          0.015,
        );
        const filling = fillings[Math.floor(pick * fillings.length)]!;
        roundedBox(
          kit,
          'food',
          s.minX + 0.075,
          s.maxX - 0.075,
          y + 0.005,
          y + 0.12,
          z - 0.165,
          z + 0.165,
          0.01,
          filling,
          1.2,
        );
      } else {
        for (let k = 0; k < 2; k++) {
          kit.lathe('glass', s.minX + 0.22, y + k * 0.12, z, [
            [0.001, 0],
            [0.058, 0],
            [0.07, 0.105],
            [0.074, 0.11],
            [0.0001, 0.11],
          ]);
        }
      }
    }
  }

  // Sheet-pan rack, two pans of croissants among the empty ones.
  const r = panRack;
  for (const x of [r.minX + 0.03, r.maxX - 0.03]) {
    for (const z of [r.minZ + 0.03, r.maxZ - 0.03]) {
      kit.cylinder('steel', x, 0, z, 0.0127, r.top, { color: '#dfe1e2', finish: SATIN });
    }
  }
  for (let i = 0; i < 12; i++) {
    const y = 0.22 + i * 0.13;
    roundedBox(
      kit,
      'steel',
      r.minX + 0.04,
      r.maxX - 0.04,
      y,
      y + 0.012,
      r.minZ + 0.05,
      r.maxZ - 0.05,
      0.005,
      '#e2e4e5',
      SATIN,
    );
    if (i === 5 || i === 6) {
      for (let k = 0; k < 8; k++) {
        const cx = r.minX + 0.16 + (k % 2) * 0.26;
        const cz = r.minZ + 0.2 + Math.floor(k / 2) * 0.27;
        kit.sphere('food', cx, y + 0.04, cz, 0.065, {
          sx: 1.3,
          sy: 0.55,
          sz: 0.7,
          ry: 0.4,
          color: '#c9813a',
          finish: 0.7,
        });
      }
    }
  }
}

/** A bottle: a body, a rounded shoulder, a long neck and a lip. */
function bottleProfile(): [number, number][] {
  return [
    [0.001, 0],
    [0.04, 0],
    [0.043, 0.004],
    [0.043, 0.15],
    [0.04, 0.17],
    [0.026, 0.195],
    [0.015, 0.21],
    [0.014, 0.25],
    [0.016, 0.255],
    [0.016, 0.262],
    [0.001, 0.262],
  ];
}

/**
 * A wire shelf whose top is at `y`: a frame of rod round it, wires across it 2.5 cm apart and a truss
 * under its middle, all within the 2 cm slab a knife meets.
 */
function wireShelf(
  kit: Kit,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  y: number,
): void {
  const frame = y - 0.009;
  const corners = [
    new Vector3(minX + 0.005, frame, minZ + 0.005),
    new Vector3(maxX - 0.005, frame, minZ + 0.005),
    new Vector3(maxX - 0.005, frame, maxZ - 0.005),
    new Vector3(minX + 0.005, frame, maxZ - 0.005),
  ];
  for (let i = 0; i < 4; i++)
    kit.rod('steel', corners[i]!, corners[(i + 1) % 4]!, 0.0055, undefined, undefined, WIRE);
  const alongZ = maxZ - minZ > maxX - minX;
  if (alongZ) {
    for (let z = minZ + 0.025; z < maxZ - 0.02; z += 0.025) {
      kit.rod(
        'steel',
        new Vector3(minX + 0.005, y - 0.008, z),
        new Vector3(maxX - 0.005, y - 0.008, z),
        0.0022,
        6,
        undefined,
        WIRE,
      );
    }
    const mid = (minX + maxX) / 2;
    kit.rod(
      'steel',
      new Vector3(mid, y - 0.015, minZ + 0.005),
      new Vector3(mid, y - 0.015, maxZ - 0.005),
      0.004,
      undefined,
      undefined,
      WIRE,
    );
  } else {
    for (let x = minX + 0.025; x < maxX - 0.02; x += 0.025) {
      kit.rod(
        'steel',
        new Vector3(x, y - 0.008, minZ + 0.005),
        new Vector3(x, y - 0.008, maxZ - 0.005),
        0.0022,
        6,
        undefined,
        WIRE,
      );
    }
    const mid = (minZ + maxZ) / 2;
    kit.rod(
      'steel',
      new Vector3(minX + 0.005, y - 0.015, mid),
      new Vector3(maxX - 0.005, y - 0.015, mid),
      0.004,
      undefined,
      undefined,
      WIRE,
    );
  }
}

/** The room, its fixtures and decoration. Station centerpieces are added separately. */
export function buildKitchen(kit: Kit): void {
  createShell(kit);
  createWindows(kit);
  createDoors(kit);
  createPiano(kit);
  createHood(kit);
  createClockHousing(kit);
  createCounters(kit);
  createPendants(kit);
}
