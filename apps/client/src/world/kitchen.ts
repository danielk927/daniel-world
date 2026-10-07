import {
  CircleGeometry,
  Color,
  ExtrudeGeometry,
  LatheGeometry,
  PlaneGeometry,
  Shape,
  TorusGeometry,
  Vector2,
  Vector3,
} from 'three';
import {
  COUNTER_HEIGHT,
  DOORS,
  KITCHEN,
  ROOM_HALF_X,
  ROOM_HALF_Z,
  ROOM_HEIGHT,
  VAULT_RISE,
  vaultHeight,
  WINDOWS,
  createRandom,
  type Fixture,
  type Wall,
} from '@world/shared';
import { at } from './builder.ts';
import { paint, type Kit, type LayerName } from './kit.ts';

/**
 * The room after the kitchen at the French Laundry: white walls under a white barrel vault with
 * skylights, a pale grey floor, a stainless cooking suite under a big hood, charcoal-topped islands,
 * and a long white counter under a strip of garden windows.
 */

const HX = ROOM_HALF_X;
const HZ = ROOM_HALF_Z;
const TOP = COUNTER_HEIGHT;
/** Counters are a body under a 6 cm work surface. */
const SLAB = 0.06;
const VAULT_SEGMENTS = 12;
/** The vault segments with a skylight, over the aisles either side of the hood. */
const SKYLIGHT_SEGMENTS = [2, VAULT_SEGMENTS - 3];
const SKYLIGHT_HALF = 6;
const SKYLIGHT_PANES = 6;
const VAULT_RADIUS = (HZ * HZ + VAULT_RISE * VAULT_RISE) / (2 * VAULT_RISE);

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
  east: { plane: HX, axis: 'z', from: -HZ, to: HZ, normal: new Vector3(-1, 0, 0), openings: [] },
  west: { plane: -HX, axis: 'z', from: -HZ, to: HZ, normal: new Vector3(1, 0, 0), openings: [] },
};

/** A point in a wall's own frame: `u` along the wall, `y` up, `d` out from the wall into the room. */
function wallPoint(wall: WallSpec, u: number, y: number, d: number): Vector3 {
  const inward = wall.axis === 'x' ? wall.normal.z : wall.normal.x;
  const p = wall.plane + inward * d;
  return wall.axis === 'x' ? new Vector3(u, y, p) : new Vector3(p, y, u);
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
): void {
  const a = wallPoint(wall, u0, y0, d0);
  const b = wallPoint(wall, u1, y1, d1);
  kit.box(
    layer,
    Math.min(a.x, b.x),
    Math.max(a.x, b.x),
    y0,
    y1,
    Math.min(a.z, b.z),
    Math.max(a.z, b.z),
    color,
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

/** Floor panels this big, with a hairline of grout between them. */
const FLOOR_PANEL = 1.0;
const GROUT = 0.012;

function createFloor(kit: Kit): void {
  const random = createRandom(202);
  kit.flat('floor', -HX, HX, -HZ, HZ, 0, true, paint.grout);
  const color = new Color();
  const cols = Math.round((HX * 2) / FLOOR_PANEL);
  const rows = Math.round((HZ * 2) / FLOOR_PANEL);
  const depth = (HZ * 2) / rows;
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x0 = -HX + col * FLOOR_PANEL;
      const z0 = -HZ + row * depth;
      // A polished floor: barely any variation, just enough to see the panels.
      color.set(paint.floor).offsetHSL(0, 0, (random() - 0.5) * 0.02);
      kit.flat(
        'floor',
        x0 + GROUT / 2,
        x0 + FLOOR_PANEL - GROUT / 2,
        z0 + GROUT / 2,
        z0 + depth - GROUT / 2,
        0.003,
        true,
        `#${color.getHexString()}`,
      );
    }
  }
}

/** Where the vault's facets meet, north to south. */
const VAULT_POINTS: readonly { z: number; y: number }[] = Array.from(
  { length: VAULT_SEGMENTS + 1 },
  (_, i) => {
    const maxAngle = Math.asin(HZ / VAULT_RADIUS);
    const angle = -maxAngle + (i / VAULT_SEGMENTS) * maxAngle * 2;
    const z = i === 0 ? -HZ : i === VAULT_SEGMENTS ? HZ : VAULT_RADIUS * Math.sin(angle);
    return { z, y: vaultHeight(z) };
  },
);

/** The skylights' openings in the vault, each as its four corners. */
export const SKYLIGHT_OPENINGS: readonly (readonly Vector3[])[] = SKYLIGHT_SEGMENTS.map((i) => {
  const a = VAULT_POINTS[i]!;
  const b = VAULT_POINTS[i + 1]!;
  return [
    new Vector3(-SKYLIGHT_HALF, a.y, a.z),
    new Vector3(SKYLIGHT_HALF, a.y, a.z),
    new Vector3(SKYLIGHT_HALF, b.y, b.z),
    new Vector3(-SKYLIGHT_HALF, b.y, b.z),
  ];
});

/** White walls, a grey cove at the floor, and the barrel vault with its skylights and light lines. */
function createShell(kit: Kit): void {
  createFloor(kit);
  for (const wall of Object.values(WALLS)) {
    wallFace(kit, wall, 0, ROOM_HEIGHT, paint.wall);
    wallBox(kit, 'shell', wall, wall.from, wall.to, 0, 0.1, 0, 0.02, paint.seam);
  }

  // The vault: a faceted arc spanning north to south, running the length of the room.
  const points = VAULT_POINTS;
  for (let i = 0; i < VAULT_SEGMENTS; i++) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const down = new Vector3(0, -1, -(a.z + b.z) / 2 / VAULT_RADIUS);
    // Skylight segments leave the middle open.
    const spans: [number, number][] = SKYLIGHT_SEGMENTS.includes(i)
      ? [
          [-HX, -SKYLIGHT_HALF],
          [SKYLIGHT_HALF, HX],
        ]
      : [[-HX, HX]];
    for (const [x0, x1] of spans) {
      kit.quad(
        'shell',
        [
          new Vector3(x0, a.y, a.z),
          new Vector3(x1, a.y, a.z),
          new Vector3(x1, b.y, b.z),
          new Vector3(x0, b.y, b.z),
        ],
        down,
        paint.vault,
      );
    }
    // The end walls rise into the vault's arch.
    for (const wall of [WALLS.east, WALLS.west]) {
      kit.quad(
        'shell',
        [
          new Vector3(wall.plane, ROOM_HEIGHT, a.z),
          new Vector3(wall.plane, ROOM_HEIGHT, b.z),
          new Vector3(wall.plane, b.y, b.z),
          new Vector3(wall.plane, a.y, a.z),
        ],
        wall.normal,
        paint.wall,
      );
    }
  }
  // Skylights: two long strips open to the evening sky over the aisles, either side of the hood,
  // each a shallow well through the vault with night glass and glazing bars at the top.
  for (const i of SKYLIGHT_SEGMENTS) {
    const a = points[i]!;
    const b = points[i + 1]!;
    const h = SKYLIGHT_HALF;
    const out = new Vector3(0, 1, (a.z + b.z) / 2 / VAULT_RADIUS).normalize();
    const lift = (p: Vector3, depth: number) => p.clone().addScaledVector(out, depth);
    const [a0, a1] = [new Vector3(-h, a.y, a.z), new Vector3(h, a.y, a.z)];
    const [b0, b1] = [new Vector3(-h, b.y, b.z), new Vector3(h, b.y, b.z)];
    const across = new Vector3(0, b.y - a.y, b.z - a.z).normalize();
    const well = 0.22;
    kit.quad('shell', [a0, a1, lift(a1, well), lift(a0, well)], across, paint.vault);
    kit.quad(
      'shell',
      [b0, b1, lift(b1, well), lift(b0, well)],
      across.clone().negate(),
      paint.vault,
    );
    kit.quad('shell', [a0, b0, lift(b0, well), lift(a0, well)], new Vector3(1, 0, 0), paint.vault);
    kit.quad('shell', [a1, b1, lift(b1, well), lift(a1, well)], new Vector3(-1, 0, 0), paint.vault);
    const glass = well - 0.04;
    kit.quad(
      'window',
      [lift(a0, glass), lift(a1, glass), lift(b1, glass), lift(b0, glass)],
      out.clone().negate(),
    );
    const mid = lift(a0.clone().add(b1).multiplyScalar(0.5), glass - 0.03);
    const length = a0.distanceTo(b0);
    const rx = Math.atan2(-(b.y - a.y), b.z - a.z);
    for (let k = 1; k < SKYLIGHT_PANES; k++) {
      const x = -h + (2 * h * k) / SKYLIGHT_PANES;
      // On the shell, which casts no shadow: the overhead light sits above the ceiling.
      kit.boxAt('shell', x, mid.y, mid.z, 0.05, 0.05, length, { rx, color: paint.windowFrame });
    }
  }
  // Light lines where the vault springs from the long walls.
  for (const wall of [WALLS.north, WALLS.south]) {
    wallBox(
      kit,
      'light',
      wall,
      -HX,
      HX,
      ROOM_HEIGHT - 0.06,
      ROOM_HEIGHT - 0.02,
      0,
      0.05,
      paint.lamp,
    );
  }
}

/** The strip of garden windows in the north wall, with dark slim frames. */
function createWindows(kit: Kit): void {
  const wall = WALLS.north;
  const { from, to, bottom, top, panes } = WINDOWS;
  const depth = 0.25;
  // Reveals: the thickness of the wall around the opening.
  kit.flat('shell', from, to, -HZ - depth, -HZ, top, false, paint.wall);
  kit.flat('shell', from, to, -HZ - depth, -HZ, bottom, true, paint.cabinet);
  kit.wall('shell', from, -HZ - depth, from, -HZ, bottom, top, new Vector3(1, 0, 0), paint.wall);
  kit.wall('shell', to, -HZ - depth, to, -HZ, bottom, top, new Vector3(-1, 0, 0), paint.wall);
  const frame = -0.12;
  const bar = 0.05;
  const color = paint.windowFrame;
  wallBox(kit, 'matte', wall, from, to, top - bar, top, frame - 0.03, frame, color);
  wallBox(kit, 'matte', wall, from, to, bottom, bottom + bar, frame - 0.03, frame, color);
  for (let i = 0; i <= panes; i++) {
    const u = from + ((to - from) * i) / panes;
    wallBox(kit, 'matte', wall, u - bar / 2, u + bar / 2, bottom, top, frame - 0.03, frame, color);
  }
  kit.add(
    'window',
    new PlaneGeometry(to - from, top - bottom),
    at((from + to) / 2, (top + bottom) / 2, -HZ - 0.1),
  );
  // Every Second Counts: The Bear's nameplate, on the wall over the windows. From the pass, the
  // line of sight runs under the hood straight to it.
  const signY = (top + ROOM_HEIGHT - 0.08) / 2;
  kit.add('sign', new PlaneGeometry(2.2, 0.5), at(0, signY, -HZ + 0.012));
  for (const side of [-1, 1]) {
    const y = signY + side * 0.265;
    kit.box('matte', -1.13, 1.13, y - 0.022, y + 0.022, -HZ, -HZ + 0.03, paint.rail);
  }
}

function createDoors(kit: Kit): void {
  // Swinging doors to the dining room, with warm light through their portholes.
  const dining = DOORS.dining;
  const south = WALLS[dining.wall];
  const { from, to, height } = dining;
  wallBox(kit, 'steel', south, from - 0.1, to + 0.1, height, height + 0.12, 0, 0.06);
  wallBox(kit, 'steel', south, from - 0.1, from, 0, height, 0, 0.06);
  wallBox(kit, 'steel', south, to, to + 0.1, 0, height, 0, 0.06);
  for (const side of [-1, 1]) {
    const u0 = side < 0 ? from : 0.015;
    const u1 = side < 0 ? -0.015 : to;
    const cu = (u0 + u1) / 2;
    wallBox(kit, 'steel', south, u0, u1, 0.03, height - 0.02, 0.01, 0.045);
    wallBox(kit, 'iron', south, u0 + 0.04, u1 - 0.04, 0.05, 0.32, 0.045, 0.05);
    kit.add('steel', new TorusGeometry(0.17, 0.022, 3, 12), at(cu, 1.55, HZ - 0.05));
    kit.add(
      'light',
      new CircleGeometry(0.16, 12),
      at(cu, 1.55, HZ - 0.047, { ry: Math.PI }),
      paint.porthole,
    );
    const hu = side < 0 ? u1 - 0.06 : u0 + 0.06;
    wallBox(kit, 'steel', south, hu - 0.015, hu + 0.015, 0.85, 1.25, 0.05, 0.08);
  }

  // The walk-in cooler: a heavy steel door with chrome hardware and a temperature readout.
  const walkIn = DOORS.walkIn;
  const east = WALLS[walkIn.wall];
  wallBox(
    kit,
    'steel',
    east,
    walkIn.from - 0.12,
    walkIn.to + 0.12,
    0,
    walkIn.height + 0.12,
    0,
    0.05,
  );
  wallBox(kit, 'steel', east, walkIn.from, walkIn.to, 0.02, walkIn.height, 0.05, 0.11);
  for (const y of [0.4, 1.8]) {
    wallBox(kit, 'steel', east, walkIn.to - 0.09, walkIn.to - 0.01, y - 0.11, y + 0.11, 0.11, 0.18);
  }
  wallBox(kit, 'steel', east, walkIn.from + 0.05, walkIn.from + 0.37, 1.07, 1.13, 0.13, 0.19);
  wallBox(kit, 'iron', east, walkIn.from - 0.45, walkIn.from - 0.23, 1.54, 1.66, 0, 0.05);
  const display = wallPoint(east, walkIn.from - 0.34, 1.6, 0.052);
  kit.add(
    'light',
    new PlaneGeometry(0.16, 0.06),
    at(display.x, display.y, display.z, { ry: -Math.PI / 2 }),
    paint.walkInDisplay,
  );

  // Back door, with the exit sign above it.
  const back = DOORS.back;
  const west = WALLS[back.wall];
  wallBox(kit, 'steel', west, back.from - 0.08, back.to + 0.08, 0, back.height + 0.08, 0, 0.04);
  wallBox(kit, 'iron', west, back.from, back.to, 0.02, back.height, 0.04, 0.08);
  kit.rod(
    'steel',
    wallPoint(west, back.from + 0.15, 1.02, 0.16),
    wallPoint(west, back.to - 0.15, 1.02, 0.16),
    0.022,
  );
  for (const u of [back.from + 0.18, back.to - 0.18]) {
    wallBox(kit, 'steel', west, u - 0.025, u + 0.025, 0.98, 1.06, 0.08, 0.16);
  }
  const signU = (back.from + back.to) / 2;
  const signY = back.height + 0.32;
  wallBox(kit, 'iron', west, signU - 0.28, signU + 0.28, signY - 0.11, signY + 0.11, 0, 0.08);
  const sign = wallPoint(west, signU, signY, 0.081);
  kit.add('exit', new PlaneGeometry(0.5, 0.18), at(sign.x, sign.y, sign.z, { ry: Math.PI / 2 }));
}

/** A counter body under a work surface, on a recessed plinth so it reads as standing on the floor. */
function counter(kit: Kit, f: Fixture, layer: LayerName, color?: string): void {
  const inset = 0.05;
  kit.box('iron', f.minX + inset, f.maxX - inset, 0, 0.1, f.minZ + inset, f.maxZ - inset);
  kit.box(layer, f.minX, f.maxX, 0.1, TOP - SLAB, f.minZ, f.maxZ, color);
  kit.box(
    layer,
    f.minX - 0.02,
    f.maxX + 0.02,
    TOP - SLAB,
    TOP,
    f.minZ - 0.02,
    f.maxZ + 0.02,
    color,
  );
}

/** Door seams and pull handles along one long face of a counter. */
function cabinetFront(kit: Kit, f: Fixture, face: 'north' | 'south', doors: number): void {
  const outward = face === 'north' ? -1 : 1;
  const z = face === 'north' ? f.minZ : f.maxZ;
  const width = (f.maxX - f.minX) / doors;
  const z0 = Math.min(z, z + outward * 0.004);
  const z1 = Math.max(z, z + outward * 0.004);
  for (let i = 1; i < doors; i++) {
    const a = f.minX + i * width;
    kit.box('matte', a - 0.004, a + 0.004, 0.14, TOP - SLAB - 0.04, z0, z1, paint.seam);
  }
  for (let i = 0; i < doors; i++) {
    const x = f.minX + width * (i + 0.5);
    kit.boxAt('steel', x, TOP - SLAB - 0.1, z + outward * 0.02, width * 0.45, 0.022, 0.022);
  }
}

/** The stainless cooking suite, with a high shelf down its spine. */
function createPiano(kit: Kit): void {
  const p = KITCHEN.piano;
  kit.box('iron', p.minX + 0.06, p.maxX - 0.06, 0, 0.12, p.minZ + 0.06, p.maxZ - 0.06);
  kit.box('steel', p.minX, p.maxX, 0.12, TOP - SLAB - 0.04, p.minZ, p.maxZ);
  kit.box(
    'steel',
    p.minX - 0.04,
    p.maxX + 0.04,
    TOP - SLAB - 0.04,
    TOP,
    p.minZ - 0.04,
    p.maxZ + 0.04,
  );

  for (const side of [-1, 1]) {
    const face = side * p.maxZ;
    // Oven doors: brushed panels with full-width bar handles.
    for (const cx of [-3.6, -1.2, 1.2, 3.6]) {
      kit.boxAt('gloss', cx, 0.45, face + side * 0.012, 2.1, 0.5, 0.03, { color: paint.ovenDoor });
      kit.rod(
        'steel',
        new Vector3(cx - 0.8, 0.64, face + side * 0.07),
        new Vector3(cx + 0.8, 0.64, face + side * 0.07),
        0.014,
      );
      for (const dx of [-0.8, 0.8]) {
        kit.boxAt('steel', cx + dx, 0.64, face + side * 0.045, 0.02, 0.02, 0.05);
      }
    }
    // A row of black knobs under the work surface.
    for (let i = 0; i < 16; i++) {
      const x = p.minX + 0.5 + i * ((p.maxX - p.minX - 1) / 15);
      kit.cylinder('iron', x, 0.78, face, 0.026, 0.045, { rx: (side * Math.PI) / 2 });
    }
    // Towel rail along the front edge.
    kit.rod(
      'steel',
      new Vector3(p.minX + 0.1, 0.8, face + side * 0.11),
      new Vector3(p.maxX - 0.1, 0.8, face + side * 0.11),
      0.016,
    );
    for (const x of [p.minX + 0.12, 0, p.maxX - 0.12]) {
      kit.rod('steel', new Vector3(x, 0.8, face), new Vector3(x, 0.8, face + side * 0.11), 0.012);
    }
  }

  // Cast iron cooking zones on the steel top.
  for (const zSide of [-1, 1]) {
    for (const xSide of [-1, 1]) {
      kit.box('iron', xSide * 1.55, xSide * 3.65, TOP, TOP + 0.01, zSide * 0.12, zSide * 1.3);
    }
  }
  kit.box('iron', -1.35, 1.35, TOP, TOP + 0.01, -1.3, 1.3);

  // The high shelf down the middle, where plates and squeeze bottles wait within reach.
  kit.box('steel', -4.2, 4.2, 1.5, 1.53, -0.2, 0.2);
  for (const x of [-4.1, -1.6, 1.6, 4.1])
    kit.box('steel', x - 0.02, x + 0.02, TOP, 1.5, -0.02, 0.02);
  for (const [x, count] of [
    [-3.4, 7],
    [3.3, 5],
  ] as const) {
    for (let i = 0; i < count; i++) {
      kit.cylinder('gloss', x, 1.53 + i * 0.018, 0, 0.14, 0.014, { color: paint.porcelain });
    }
  }
  for (const [x, color] of [
    [-0.4, '#f4f1ea'],
    [-0.25, '#c0392b'],
    [-0.1, '#f2c94c'],
    [0.6, '#f4f1ea'],
  ] as const) {
    kit.cylinder('matte', x, 1.53, 0.05, 0.03, 0.17, { color });
    kit.cylinder('matte', x, 1.7, 0.05, 0.012, 0.04, { taper: 0.4, color });
  }
}

/** The hood: a steel skirt with a lit, gridded underside, boxed up into the vault in white. */
function createHood(kit: Kit): void {
  const h = KITCHEN.hood;
  const skirtTop = h.top - 0.05;
  const t = 0.04;
  kit.box('steel', h.minX, h.maxX, h.bottom, skirtTop, h.minZ, h.minZ + t);
  kit.box('steel', h.minX, h.maxX, h.bottom, skirtTop, h.maxZ - t, h.maxZ);
  kit.box('steel', h.minX, h.minX + t, h.bottom, skirtTop, h.minZ, h.maxZ);
  kit.box('steel', h.maxX - t, h.maxX, h.bottom, skirtTop, h.minZ, h.maxZ);
  const ceiling = skirtTop - 0.002;
  const cell = 0.6;
  for (let x = h.minX + t + 0.03; x + cell <= h.maxX - t; x += cell) {
    for (let z = h.minZ + t + 0.08; z + cell <= h.maxZ - t; z += cell) {
      kit.flat(
        'shell',
        x + 0.02,
        x + cell - 0.02,
        z + 0.02,
        z + cell - 0.02,
        ceiling,
        false,
        paint.filter,
      );
    }
  }
  for (let i = 0; i < 6; i++) {
    for (const z of [-0.95, 0.95]) {
      kit.add(
        'light',
        new CircleGeometry(0.09, 10),
        at(-4 + i * 1.6, ceiling - 0.003, z, { rx: Math.PI / 2 }),
        paint.lamp,
      );
    }
  }
  kit.box('shell', h.minX, h.maxX, skirtTop, vaultHeight(0) + 0.05, h.minZ, h.maxZ, paint.vault);

  // Three Michelin stars on the hood's north face, as at the French Laundry.
  const star = new Shape();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? 0.13 : 0.055;
    const a = Math.PI / 2 + (i / 10) * Math.PI * 2;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const starGeometry = new ExtrudeGeometry(star, { depth: 0.015, bevelEnabled: false });
  // High on the fascia, above the skirt, where they face the islands.
  const plaqueY = 4.0;
  for (const x of [-0.75, 0, 0.75]) {
    kit.boxAt('gloss', x, plaqueY, h.minZ - 0.015, 0.42, 0.42, 0.03, { color: paint.plaque });
    kit.add('steel', starGeometry, at(x, plaqueY, h.minZ - 0.03, { ry: Math.PI }));
  }
}

/** The LED clock's display, in meters: four times as wide as it is tall, like its face. */
export const CLOCK_SIZE = { width: 1.16, height: 0.29 } as const;

/**
 * Where the kitchen clock's faces are: hung under the front of the hood, between two heat lamps,
 * where the aisle by the dining room doors looks straight at it, and its twin on the hood's north
 * face under the stars, for the line and the windows. KitchenClock draws them.
 */
export const CLOCK_DISPLAYS = [
  { x: 1.5, y: 2.45, z: KITCHEN.hood.maxZ + 0.052, ry: 0 },
  { x: 0, y: 3.45, z: KITCHEN.hood.minZ - 0.052, ry: Math.PI },
] as const;

/** The clock's black housings; the faces themselves are KitchenClock's. */
function createClockHousings(kit: Kit): void {
  for (const face of CLOCK_DISPLAYS) {
    const z = face.z - Math.cos(face.ry) * 0.027;
    kit.boxAt('matte', face.x, face.y, z, CLOCK_SIZE.width + 0.14, CLOCK_SIZE.height + 0.13, 0.05, {
      color: '#151414',
    });
    // The front clock hangs from the hood's skirt on two short rods.
    const top = face.y + (CLOCK_SIZE.height + 0.13) / 2;
    if (top < KITCHEN.hood.bottom) {
      for (const dx of [-0.45, 0.45]) {
        kit.box(
          'steel',
          face.x + dx - 0.01,
          face.x + dx + 0.01,
          top,
          KITCHEN.hood.bottom,
          z - 0.01,
          z + 0.01,
        );
      }
    }
  }
}

/** A charcoal-topped prep island on a steel frame, plates stacked on its open shelves. */
function island(kit: Kit, f: Fixture): void {
  const random = createRandom(Math.round((f.minX + 10) * 100));
  const cz = (f.minZ + f.maxZ) / 2;
  kit.box(
    'matte',
    f.minX - 0.04,
    f.maxX + 0.04,
    TOP - SLAB,
    TOP,
    f.minZ - 0.04,
    f.maxZ + 0.04,
    paint.charcoal,
  );
  kit.box(
    'steel',
    f.minX + 0.03,
    f.maxX - 0.03,
    TOP - SLAB - 0.08,
    TOP - SLAB,
    f.minZ + 0.03,
    f.maxZ - 0.03,
  );
  for (const y of [0.16, 0.5]) {
    kit.box('steel', f.minX + 0.05, f.maxX - 0.05, y, y + 0.025, f.minZ + 0.05, f.maxZ - 0.05);
  }
  for (const x of [f.minX + 0.06, f.maxX - 0.06]) {
    for (const z of [f.minZ + 0.06, f.maxZ - 0.06]) {
      kit.box('steel', x - 0.025, x + 0.025, 0.07, TOP - SLAB, z - 0.025, z + 0.025);
      kit.cylinder('iron', x, 0.035, z - 0.03, 0.035, 0.06, { rx: Math.PI / 2 });
    }
  }
  // A few stacks of white plates and bowls on each shelf.
  for (const y of [0.185, 0.525]) {
    for (let x = f.minX + 0.45; x < f.maxX - 0.3; x += 0.75) {
      const stack = 4 + Math.floor(random() * 6);
      const bowls = random() < 0.4;
      for (let i = 0; i < stack; i++) {
        kit.cylinder(
          'gloss',
          x,
          y + i * (bowls ? 0.03 : 0.018),
          cz,
          bowls ? 0.11 : 0.14,
          bowls ? 0.05 : 0.014,
          {
            taper: bowls ? 1.4 : 1,
            color: paint.porcelain,
          },
        );
      }
    }
  }
}

/** The bottom of the brass pendant shades over the islands, above any head, even mid-jump. */
const PENDANT_Y = 2.95;

/** Where the pendant lamps over the two islands hang: a pair along each, by their bulbs. */
export const PENDANTS: readonly Vector3[] = [KITCHEN.pastryIsland, KITCHEN.gardeManger].flatMap(
  (f) => {
    const cx = (f.minX + f.maxX) / 2;
    const cz = (f.minZ + f.maxZ) / 2;
    return [-1, 1].map((side) => new Vector3(cx + side * 1.05, PENDANT_Y + 0.06, cz));
  },
);

/** A wide brass dome, open below, with a thin wall so it reads from above and below. */
const PENDANT_SHADE = new LatheGeometry(
  [
    [0.001, 0.2],
    [0.05, 0.2],
    [0.17, 0.14],
    [0.25, 0.0],
    [0.24, 0.0],
    [0.16, 0.13],
    [0.045, 0.19],
    [0.001, 0.19],
  ].map(([x, y]) => new Vector2(x, y)),
  12,
);

/** Brass pendants on long rods from the vault, each with a glowing bulb inside the shade. */
function createPendants(kit: Kit): void {
  for (const p of PENDANTS) {
    kit.add('brass', PENDANT_SHADE, at(p.x, PENDANT_Y, p.z));
    kit.sphere('light', p.x, p.y, p.z, 0.055, { sy: 0.8, color: paint.lamp });
    const top = vaultHeight(p.z);
    kit.cylinder('iron', p.x, PENDANT_Y + 0.2, p.z, 0.008, top - PENDANT_Y - 0.2, { segments: 4 });
  }
}

function createCounters(kit: Kit): void {
  const { pass, gardeManger, pastryIsland, windowCounter, plonge, fridge, shelving, panRack } =
    KITCHEN;
  counter(kit, pass, 'steel');
  cabinetFront(kit, pass, 'north', 6);

  island(kit, gardeManger);
  island(kit, pastryIsland);

  // The window counter: white cabinets and top, three sinks with gooseneck taps, a white splash.
  const w = windowCounter;
  counter(kit, w, 'gloss', paint.cabinet);
  cabinetFront(kit, w, 'south', 12);
  kit.box('gloss', w.minX, w.maxX, TOP, WINDOWS.bottom, -HZ, -HZ + 0.03, paint.cabinet);
  const tap = new TorusGeometry(0.12, 0.012, 3, 10, Math.PI);
  for (const cx of [-4.5, 0, 4.5]) {
    kit.box('iron', cx - 0.4, cx + 0.4, TOP, TOP + 0.003, -6.32, -5.98);
    kit.cylinder('steel', cx, TOP, -6.4, 0.016, 0.28);
    kit.add('steel', tap, at(cx, TOP + 0.28, -6.28, { ry: Math.PI / 2 }));
  }

  // Dish pit on the south wall: steel, two sinks, a splash, and a shelf of hotel pans above.
  const d = plonge;
  counter(kit, d, 'steel');
  cabinetFront(kit, d, 'north', 4);
  kit.box('steel', d.minX, d.maxX, TOP, 1.38, HZ - 0.03, HZ);
  for (const cx of [5.3, 7.2]) kit.box('iron', cx - 0.5, cx + 0.5, TOP, TOP + 0.002, 5.95, 6.38);
  kit.box('steel', d.minX, d.maxX, 1.88, 1.92, HZ - 0.42, HZ);
  for (let i = 0; i < 5; i++) {
    const x = d.minX + 0.4 + i * 0.65;
    for (let k = 0; k < 3; k++) {
      kit.box('steel', x - 0.22, x + 0.22, 1.92 + k * 0.07, 1.98 + k * 0.07, HZ - 0.37, HZ - 0.05);
    }
  }

  // Reach-in fridge: lit from inside, behind a glass door facing the room.
  const fr = fridge;
  const front = fr.minX + 0.45;
  kit.box('steel', front, fr.maxX, 0, fr.top, fr.minZ, fr.maxZ);
  kit.box('steel', fr.minX, front, 0, 0.2, fr.minZ, fr.maxZ);
  kit.box('steel', fr.minX, front, fr.top - 0.2, fr.top, fr.minZ, fr.maxZ);
  kit.box('steel', fr.minX, front, 0.2, fr.top - 0.2, fr.minZ, fr.minZ + 0.1);
  kit.box('steel', fr.minX, front, 0.2, fr.top - 0.2, fr.maxZ - 0.1, fr.maxZ);
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
  const bottleColors = ['#3d6b35', '#8c1c2b', '#e8d9a8', '#f2f2f2'];
  for (let shelf = 0; shelf < 3; shelf++) {
    const y = 0.55 + shelf * 0.45;
    kit.box('steel', fr.minX + 0.05, front, y - 0.012, y, fr.minZ + 0.1, fr.maxZ - 0.1);
    for (let i = 0; i < 4; i++) {
      kit.cylinder('gloss', fr.minX + 0.25, y, fr.minZ + 0.35 + i * 0.3, 0.045, 0.26, {
        color: bottleColors[(i + shelf) % bottleColors.length],
        taper: 0.45,
      });
    }
  }
  kit.add(
    'glass',
    new PlaneGeometry(fr.maxZ - fr.minZ - 0.2, fr.top - 0.4),
    at(fr.minX + 0.02, fr.top / 2, (fr.minZ + fr.maxZ) / 2, { ry: -Math.PI / 2 }),
  );
  kit.boxAt('steel', fr.minX - 0.03, 1.1, fr.minZ + 0.18, 0.03, 0.7, 0.03);

  // Open storage shelving: wire shelves of clear tubs and deli containers.
  const s = shelving;
  for (const x of [s.minX + 0.02, s.maxX - 0.02]) {
    for (const z of [s.minZ + 0.02, s.maxZ - 0.02]) {
      kit.box('steel', x - 0.015, x + 0.015, 0, s.top, z - 0.015, z + 0.015);
    }
  }
  const random = createRandom(55);
  const fillings = ['#efe6cf', '#d9b36c', '#b8c98f'];
  for (const y of [0.3, 0.85, 1.4, 1.95]) {
    kit.box('steel', s.minX, s.maxX, y - 0.02, y, s.minZ, s.maxZ);
    if (y > 1.9) continue;
    for (let z = s.minZ + 0.3; z < s.maxZ - 0.2; z += 0.5) {
      if (random() < 0.5) {
        kit.box('glass', s.minX + 0.06, s.maxX - 0.06, y, y + 0.28, z - 0.18, z + 0.18);
        const filling = fillings[Math.floor(random() * fillings.length)]!;
        kit.box('matte', s.minX + 0.08, s.maxX - 0.08, y, y + 0.12, z - 0.16, z + 0.16, filling);
      } else {
        for (let k = 0; k < 2; k++) {
          kit.cylinder('matte', s.minX + 0.22, y + k * 0.12, z, 0.07, 0.11, { color: '#f4f2ec' });
        }
      }
    }
  }

  // Sheet-pan rack, two pans of croissants among the empty ones.
  const r = panRack;
  for (const x of [r.minX + 0.03, r.maxX - 0.03]) {
    for (const z of [r.minZ + 0.03, r.maxZ - 0.03]) {
      kit.box('steel', x - 0.015, x + 0.015, 0, r.top, z - 0.015, z + 0.015);
    }
  }
  for (let i = 0; i < 12; i++) {
    const y = 0.22 + i * 0.13;
    kit.box('steel', r.minX + 0.04, r.maxX - 0.04, y, y + 0.012, r.minZ + 0.05, r.maxZ - 0.05);
    if (i === 5 || i === 6) {
      for (let k = 0; k < 8; k++) {
        const cx = r.minX + 0.16 + (k % 2) * 0.26;
        const cz = r.minZ + 0.2 + Math.floor(k / 2) * 0.27;
        kit.sphere('gloss', cx, y + 0.04, cz, 0.065, {
          sx: 1.3,
          sy: 0.55,
          sz: 0.7,
          ry: 0.4,
          color: '#c9813a',
        });
      }
    }
  }
}

/** The room, its fixtures and decoration. Station centerpieces are added separately. */
export function buildKitchen(kit: Kit): void {
  createShell(kit);
  createWindows(kit);
  createDoors(kit);
  createPiano(kit);
  createHood(kit);
  createClockHousings(kit);
  createCounters(kit);
  createPendants(kit);
}
