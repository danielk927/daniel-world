import {
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Float32BufferAttribute,
  TorusGeometry,
  Vector3,
} from 'three';
import { COOLER, COOLER_SHELVES, DOORS, ROOM_HALF_X, type Fixture } from '@world/shared';
import type { Kit } from './kit.ts';

/**
 * The walk-in cooler's doorway and the cold room behind it: white insulated panels over aluminum
 * plate, a grey floor, two vapor-proof lamps, the refrigeration unit high on the back wall and
 * empty wire shelving, waiting to be filled. All static, through the Kit. The door is CoolerDoor's.
 */

const DOORWAY = DOORS.walkIn;
/** The kitchen face of the east wall. */
const FACE = ROOM_HALF_X;
/** The steel frame round the doorway, on the kitchen face. */
const CASING = 0.12;
const CASING_DEPTH = 0.05;

/** Where the temperature controller hangs, on the wall beside the door: its readout's middle. */
export const READOUT = {
  x: FACE - 0.052,
  y: 1.6,
  z: DOORWAY.from - 0.34,
  width: 0.16,
  height: 0.06,
} as const;

/** Cool white, from the cold room's lamps. */
export const COLD_LIGHT = new Color('#dcebff');
/** Warm, the kitchen's light coming in through the doorway. */
const WARM_LIGHT = new Color('#ffc58f');

/** The lamps on the cold room's ceiling, along its middle. */
export const COOLER_LAMPS = {
  y: COOLER.height - 0.08,
  z: (COOLER.minZ + COOLER.maxZ) / 2,
  xs: [COOLER.minX + 0.95, COOLER.maxX - 0.95],
} as const;

/** The doorway's frame and the cold room behind it. */
export function buildCooler(kit: Kit): void {
  const { from, to, height } = DOORWAY;
  // A heavy steel frame on the kitchen face, and linings through the wall's thickness.
  kit.box('steel', FACE - CASING_DEPTH, FACE, 0, height + CASING, from - CASING, from);
  kit.box('steel', FACE - CASING_DEPTH, FACE, 0, height + CASING, to, to + CASING);
  kit.box('steel', FACE - CASING_DEPTH, FACE, height, height + CASING, from, to);
  kit.box('steel', FACE, COOLER.minX, 0, height, from - 0.01, from);
  kit.box('steel', FACE, COOLER.minX, height, height + 0.01, from, to);
  kit.box('steel', FACE, COOLER.minX, 0, height, to, to + 0.01);
  kit.box('steel', FACE - CASING_DEPTH, COOLER.minX, 0, 0.012, from, to);
  // The temperature controller on the wall beside the door; CoolerDoor draws its readout.
  const r = READOUT;
  kit.box('iron', FACE - 0.05, FACE, r.y - 0.06, r.y + 0.06, r.z - 0.11, r.z + 0.11);
  buildRoom(kit);
}

// ---------- Baked light ----------

interface BakedLight {
  readonly position: Vector3;
  /** The way it shines; it lights a wide lobe round this. */
  readonly axis: Vector3;
  readonly color: Color;
  readonly power: number;
  /** How tightly it keeps to its axis: 0 shines every way. */
  readonly lobe: number;
}

/**
 * The cold room's light, baked into its vertex colors: it has no windows and the kitchen's lamps
 * must not reach into it, so it is drawn unlit (one draw call), lit by its two ceiling lamps, a
 * little warm light in through the doorway, and soft shadow where walls meet.
 */
const LIGHTS: readonly BakedLight[] = [
  ...COOLER_LAMPS.xs.flatMap((x) =>
    [-0.4, 0.4].map((dz) => ({
      position: new Vector3(x, COOLER_LAMPS.y, COOLER_LAMPS.z + dz),
      axis: new Vector3(0, -1, 0),
      color: COLD_LIGHT,
      power: 0.6,
      lobe: 0.6,
    })),
  ),
  ...[0.45, 1.25].map((y) => ({
    position: new Vector3(COOLER.minX - 0.15, y, (DOORWAY.from + DOORWAY.to) / 2),
    axis: new Vector3(1, -0.2, 0).normalize(),
    color: WARM_LIGHT,
    power: 0.2,
    lobe: 1.2,
  })),
];

const AMBIENT = 0.19;
const toLight = new Vector3();
const lightColor = new Color();

/** The light falling on a point with normal `n`, as a color to multiply a surface's paint by. */
function bake(p: Vector3, n: Vector3, out: Color): Color {
  // Light bounced round the white room, a little weaker into corners and along edges.
  const distances = [
    p.x - COOLER.minX,
    COOLER.maxX - p.x,
    p.z - COOLER.minZ,
    COOLER.maxZ - p.z,
    p.y,
    COOLER.height - p.y,
  ];
  const facing = [n.x, n.x, n.z, n.z, n.y, n.y];
  let ao = 1;
  for (let i = 0; i < 6; i++) {
    // A plane the surface faces along (its own, or the one across) does not shade it.
    if (Math.abs(facing[i]!) > 0.5 || distances[i]! < 0) continue;
    ao *= 1 - 0.32 * Math.exp(-distances[i]! / 0.22);
  }
  out.copy(COLD_LIGHT).multiplyScalar(AMBIENT * ao * (0.85 + 0.15 * Math.max(0, n.y)));
  for (const light of LIGHTS) {
    toLight.subVectors(light.position, p);
    const d2 = toLight.lengthSq();
    toLight.normalize();
    const lambert = Math.max(0, n.dot(toLight));
    const lobe = Math.pow(Math.max(0, -toLight.dot(light.axis)), light.lobe);
    const falloff = (3 * light.power) / (0.35 + d2);
    out.add(lightColor.copy(light.color).multiplyScalar(lambert * lobe * falloff));
  }
  return out;
}

const paintColor = new Color();
const litColor = new Color();
const point = new Vector3();
const normal = new Vector3();

/** Add `geometry` to the cold room, each vertex painted `paint` in the light falling on it there. */
function baked(kit: Kit, geometry: BufferGeometry, paint: string): void {
  const position = geometry.getAttribute('position');
  if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
  const normals = geometry.getAttribute('normal');
  const colors = new Float32Array(position.count * 3);
  paintColor.set(paint);
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i);
    normal.fromBufferAttribute(normals, i);
    bake(point, normal, litColor).multiply(paintColor);
    colors.set([litColor.r, litColor.g, litColor.b], i * 3);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  kit.add('cold', geometry);
}

/**
 * A rectangle in the cold room, split into cells so the baked light can vary across it: corner
 * `origin`, edges `u` and `v`, facing `facing`.
 */
function bakedQuad(
  kit: Kit,
  origin: Vector3,
  u: Vector3,
  v: Vector3,
  facing: Vector3,
  paint: string,
): void {
  const cell = 0.25;
  const nu = Math.max(1, Math.round(u.length() / cell));
  const nv = Math.max(1, Math.round(v.length() / cell));
  const positions: number[] = [];
  const normals: number[] = [];
  const index: number[] = [];
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      point
        .copy(origin)
        .addScaledVector(u, i / nu)
        .addScaledVector(v, j / nv);
      positions.push(point.x, point.y, point.z);
      normals.push(facing.x, facing.y, facing.z);
    }
  }
  // Wound to face `facing`.
  const forward = normal.crossVectors(u, v).dot(facing) > 0;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i;
      const b = a + 1;
      const c = a + nu + 1;
      const d = c + 1;
      if (forward) index.push(a, b, d, a, d, c);
      else index.push(a, d, b, a, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  geometry.setIndex(index);
  baked(kit, geometry, paint);
}

/** A box in the cold room by its extents. */
function bakedBox(
  kit: Kit,
  minX: number,
  maxX: number,
  minY: number,
  maxY: number,
  minZ: number,
  maxZ: number,
  paint: string,
): void {
  const box = new BoxGeometry(maxX - minX, maxY - minY, maxZ - minZ);
  box.translate((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2);
  baked(kit, box, paint);
}

// ---------- The room ----------

const PANEL = '#eef2f5';
const SEAM = '#c3ccd3';
const WAINSCOT = '#b4bbc0';
const WAINSCOT_CAP = '#d9dee2';
const FLOOR = '#8f979c';
const FLOOR_SEAM = '#7c848a';
const CEILING = '#f2f5f7';
const CHROME = '#d2d8dc';
const EVAPORATOR = '#e2e7ea';
const FAN = '#33393d';
const COIL = '#7b858c';
const FROST = '#f6fafc';

/** Aluminum plate round the bottom of the walls, up to here. */
const WAINSCOT_TOP = 0.9;
/** The insulated wall and ceiling panels are this wide. */
const PANEL_WIDTH = 1.15;

/** A strip on a wall, from `a` to `b` along it, between two heights, standing `proud` off it. */
function wallStrip(
  kit: Kit,
  origin: Vector3,
  along: Vector3,
  facing: Vector3,
  a: number,
  b: number,
  y0: number,
  y1: number,
  proud: number,
  paint: string,
): void {
  const p = origin.clone().addScaledVector(along, a);
  const q = origin.clone().addScaledVector(along, b).addScaledVector(facing, proud);
  bakedBox(
    kit,
    Math.min(p.x, q.x),
    Math.max(p.x, q.x),
    y0,
    y1,
    Math.min(p.z, q.z),
    Math.max(p.z, q.z),
    paint,
  );
}

/**
 * One wall of the cold room, its inside face, from `origin` along `along` for `length`: aluminum
 * plate below, white panels above, seams between them, and a doorway left open where asked.
 */
function coldWall(
  kit: Kit,
  origin: Vector3,
  along: Vector3,
  length: number,
  facing: Vector3,
  doorway?: { from: number; to: number; top: number },
): void {
  const up = new Vector3(0, 1, 0);
  const spans: [number, number, number][] = doorway
    ? [
        [0, doorway.from, 0],
        [doorway.from, doorway.to, doorway.top],
        [doorway.to, length, 0],
      ]
    : [[0, length, 0]];
  for (const [a, b, bottom] of spans) {
    if (b - a < 1e-3) continue;
    const start = origin.clone().addScaledVector(along, a);
    const span = along.clone().multiplyScalar(b - a);
    const y0 = Math.max(bottom, WAINSCOT_TOP);
    if (bottom < WAINSCOT_TOP) {
      bakedQuad(kit, start, span, up.clone().multiplyScalar(WAINSCOT_TOP), facing, WAINSCOT);
      // The plate's top edge, a little proud.
      wallStrip(
        kit,
        origin,
        along,
        facing,
        a,
        b,
        WAINSCOT_TOP - 0.02,
        WAINSCOT_TOP + 0.015,
        0.012,
        WAINSCOT_CAP,
      );
    }
    bakedQuad(
      kit,
      start.clone().setY(y0),
      span,
      up.clone().multiplyScalar(COOLER.height - y0),
      facing,
      PANEL,
    );
  }
  for (let s = PANEL_WIDTH; s < length - 0.1; s += PANEL_WIDTH) {
    if (doorway && s > doorway.from - 0.05 && s < doorway.to + 0.05) continue;
    wallStrip(
      kit,
      origin,
      along,
      facing,
      s - 0.006,
      s + 0.006,
      WAINSCOT_TOP + 0.015,
      COOLER.height,
      0.003,
      SEAM,
    );
  }
}

function buildRoom(kit: Kit): void {
  const { minX, maxX, minZ, maxZ, height } = COOLER;
  const depth = maxX - minX;
  const width = maxZ - minZ;
  // The floor, with seams between its plates, and the ceiling with its panel seams.
  const x = new Vector3(depth, 0, 0);
  const z = new Vector3(0, 0, width);
  bakedQuad(kit, new Vector3(minX, 0, minZ), x, z, new Vector3(0, 1, 0), FLOOR);
  // Standing a few millimeters proud, so the floor never shows through them in the distance.
  for (let s = minX + 1.2; s < maxX - 0.1; s += 1.2) {
    bakedBox(kit, s - 0.007, s + 0.007, 0, 0.005, minZ, maxZ, FLOOR_SEAM);
  }
  for (let s = minZ + 1.0; s < maxZ - 0.1; s += 1.0) {
    bakedBox(kit, minX, maxX, 0, 0.005, s - 0.007, s + 0.007, FLOOR_SEAM);
  }
  bakedQuad(kit, new Vector3(minX, height, minZ), x, z, new Vector3(0, -1, 0), CEILING);
  for (let s = minX + PANEL_WIDTH; s < maxX - 0.1; s += PANEL_WIDTH) {
    bakedBox(kit, s - 0.006, s + 0.006, height - 0.003, height, minZ, maxZ, SEAM);
  }
  // The four walls; the west one has the doorway in it.
  coldWall(kit, new Vector3(minX, 0, minZ), new Vector3(0, 0, 1), width, new Vector3(1, 0, 0), {
    from: DOORWAY.from - minZ,
    to: DOORWAY.to - minZ,
    top: DOORWAY.height,
  });
  coldWall(kit, new Vector3(maxX, 0, maxZ), new Vector3(0, 0, -1), width, new Vector3(-1, 0, 0));
  coldWall(kit, new Vector3(maxX, 0, minZ), new Vector3(-1, 0, 0), depth, new Vector3(0, 0, 1));
  coldWall(kit, new Vector3(minX, 0, maxZ), new Vector3(1, 0, 0), depth, new Vector3(0, 0, -1));

  // Vapor-proof lamps on the ceiling: a white housing round a glowing lens.
  const { y, z: lampZ, xs } = COOLER_LAMPS;
  for (const lampX of xs) {
    bakedBox(
      kit,
      lampX - 0.09,
      lampX + 0.09,
      height - 0.07,
      height,
      lampZ - 0.65,
      lampZ + 0.65,
      PANEL,
    );
    kit.box(
      'light',
      lampX - 0.065,
      lampX + 0.065,
      y,
      y + 0.01,
      lampZ - 0.6,
      lampZ + 0.6,
      '#9fb7cc',
    );
  }

  buildEvaporator(kit);
  for (const shelf of COOLER_SHELVES) buildShelving(kit, shelf);
}

/** The refrigeration unit high on the back wall: a white box, two fans, and a frosted coil. */
function buildEvaporator(kit: Kit): void {
  const { maxX, height } = COOLER;
  const front = maxX - 0.42;
  const top = height - 0.06;
  const bottom = height - 0.52;
  const coil = bottom + 0.11;
  const z0 = -4.9;
  const z1 = -3.4;
  bakedBox(kit, front, maxX, coil, top, z0, z1, EVAPORATOR);
  // The coil along the bottom: frosted fins between the casing's ends, over a drip tray.
  bakedBox(kit, front + 0.03, maxX, bottom, coil, z0 + 0.03, z1 - 0.03, COIL);
  bakedBox(kit, front - 0.01, maxX, bottom - 0.025, bottom, z0, z1, EVAPORATOR);
  for (const end of [z0, z1 - 0.03])
    bakedBox(kit, front, maxX, bottom, coil, end, end + 0.03, EVAPORATOR);
  for (let s = z0 + 0.05; s < z1 - 0.04; s += 0.025) {
    bakedBox(
      kit,
      front + 0.005,
      maxX - 0.02,
      bottom + 0.004,
      coil - 0.004,
      s - 0.004,
      s + 0.004,
      FROST,
    );
  }
  // Two fans behind round guards: a dark well, rings of wire, and a hub.
  const fanY = (coil + top) / 2;
  for (const fanZ of [z0 + 0.4, z1 - 0.4]) {
    const r = 0.15;
    const disc = new CylinderGeometry(r, r, 0.012, 12);
    disc.rotateZ(Math.PI / 2).translate(front - 0.006, fanY, fanZ);
    baked(kit, disc, FAN);
    for (const ring of [r, r * 0.68, r * 0.36]) {
      const wire = new TorusGeometry(ring, 0.005, 3, 16);
      wire.rotateY(Math.PI / 2).translate(front - 0.016, fanY, fanZ);
      baked(kit, wire, CHROME);
    }
    const hub = new CylinderGeometry(0.035, 0.035, 0.02, 8);
    hub.rotateZ(Math.PI / 2).translate(front - 0.02, fanY, fanZ);
    baked(kit, hub, CHROME);
  }
  // Its drain line, down the wall to the floor.
  bakedBox(kit, maxX - 0.05, maxX - 0.02, 0.05, bottom, z1 - 0.12, z1 - 0.09, CHROME);
}

/** Wire shelving: four posts and four shelves of wire, each a frame with wires across it. */
function buildShelving(kit: Kit, f: Fixture): void {
  const post = 0.014;
  const inset = 0.02;
  const [x0, x1] = [f.minX + inset, f.maxX - inset];
  const [z0, z1] = [f.minZ + inset, f.maxZ - inset];
  for (const x of [x0, x1]) {
    for (const z of [z0, z1])
      bakedBox(kit, x - post, x + post, 0, f.top, z - post, z + post, CHROME);
  }
  const alongX = x1 - x0 > z1 - z0;
  const wire = 0.0035;
  for (const y of [0.18, 0.72, 1.26, f.top - 0.03]) {
    // The frame.
    for (const z of [z0, z1])
      bakedBox(kit, x0, x1, y - 0.012, y + 0.012, z - 0.006, z + 0.006, CHROME);
    for (const x of [x0, x1])
      bakedBox(kit, x - 0.006, x + 0.006, y - 0.012, y + 0.012, z0, z1, CHROME);
    // Wires across the short way, and a truss down the middle underneath.
    if (alongX) {
      for (let x = x0 + 0.08; x < x1 - 0.03; x += 0.08) {
        bakedBox(kit, x - wire, x + wire, y + 0.006, y + 0.012, z0, z1, CHROME);
      }
      const mid = (z0 + z1) / 2;
      bakedBox(kit, x0, x1, y - 0.02, y - 0.008, mid - wire, mid + wire, CHROME);
    } else {
      for (let z = z0 + 0.08; z < z1 - 0.03; z += 0.08) {
        bakedBox(kit, x0, x1, y + 0.006, y + 0.012, z - wire, z + wire, CHROME);
      }
      const mid = (x0 + x1) / 2;
      bakedBox(kit, mid - wire, mid + wire, y - 0.02, y - 0.008, z0, z1, CHROME);
    }
  }
}
