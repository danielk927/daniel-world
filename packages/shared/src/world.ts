import {
  PLAY_HALF_X,
  PLAY_HALF_Z,
  PLAYER_RADIUS,
  ROOM_HALF_X,
  ROOM_HALF_Z,
  ROOM_HEIGHT,
} from './constants.ts';
import { createRandom } from './random.ts';

/**
 * The static world layout: a classical French brigade kitchen. Client and server both build
 * colliders from this, and the client renders from it, so the two can never disagree about where a
 * counter or a station is.
 *
 * Axes: +X is east, -Z is north. The dining room doors are in the south wall, and a new player
 * stands between them and the pass, looking north over the pass and the piano.
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

/** An axis-aligned footprint on the floor. */
export interface Footprint {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

export interface Fixture extends Footprint {
  /** Height of the work surface (or the top of a tall unit). */
  readonly top: number;
}

/** Every work surface in the kitchen is at this height. */
export const COUNTER_HEIGHT = 0.92;

/**
 * Fixture colliders reach well above the work surface, so nobody can jump onto a counter and end
 * up with their head inside a heat lamp or the hood. Props sit in that column of blocked space.
 */
export const FIXTURE_COLLIDER_TOP = 2.4;

/**
 * The fixtures, after the kitchen at the French Laundry: the cooking suite in the middle under its
 * hood, the pass between it and the dining room, two prep islands behind it, a long counter under
 * the garden windows, the dish pit by the dining room, and storage on the end walls.
 */
export const KITCHEN = {
  /** The central cooking suite. The four hot stations work around it. */
  piano: { minX: -4.8, maxX: 4.8, minZ: -1.4, maxZ: 1.4, top: COUNTER_HEIGHT },
  /** The extraction hood over the piano. Hangs low enough to bump a jumping head. */
  hood: { minX: -5.4, maxX: 5.4, minZ: -2.0, maxZ: 2.0, bottom: 2.7, top: 3.2 },
  /** Where plates are checked under heat lamps before they go out to the dining room. */
  pass: { minX: -4.5, maxX: 4.5, minZ: 3.9, maxZ: 4.7, top: COUNTER_HEIGHT },
  /** The cold station: a charcoal-topped island north-east of the piano. */
  gardeManger: { minX: 1.2, maxX: 5.2, minZ: -4.7, maxZ: -3.7, top: COUNTER_HEIGHT },
  /** The pastry island, its twin north-west of the piano. */
  pastryIsland: { minX: -5.2, maxX: -1.2, minZ: -4.7, maxZ: -3.7, top: COUNTER_HEIGHT },
  /** The long white counter with sinks under the garden windows, on the north wall. */
  windowCounter: { minX: -7.3, maxX: 7.3, minZ: -ROOM_HALF_Z, maxZ: -5.85, top: COUNTER_HEIGHT },
  /** Dish pit sinks on the south wall, by the dining room doors. */
  plonge: { minX: 4.6, maxX: ROOM_HALF_X, minZ: 5.85, maxZ: ROOM_HALF_Z, top: COUNTER_HEIGHT },
  /** Tall reach-in fridge on the east wall. */
  fridge: { minX: 7.1, maxX: ROOM_HALF_X, minZ: -1.0, maxZ: 0.6, top: 2.1 },
  /** Open storage shelving on the east wall, next to the fridge. */
  shelving: { minX: 7.55, maxX: ROOM_HALF_X, minZ: 1.0, maxZ: 3.4, top: 2.0 },
  /** Sheet-pan rack against the west wall. */
  panRack: { minX: -ROOM_HALF_X, maxX: -7.4, minZ: -2.2, maxZ: -1.0, top: 1.9 },
  /** The chef's desk in the south-west corner, with the kitchen computer on it. */
  desk: { minX: -ROOM_HALF_X, maxX: -7.2, minZ: 4.9, maxZ: 6.3, top: COUNTER_HEIGHT },
} as const satisfies Record<string, Fixture | (Fixture & { bottom: number })>;

export type Wall = 'north' | 'south' | 'east' | 'west';

/**
 * Doors are painted onto the walls; nobody walks through them, except the walk-in's once it has
 * been broken open (see COOLER). Spans run along the wall: x for the north and south walls, z for
 * the east and west walls.
 */
export interface Door {
  readonly wall: Wall;
  readonly from: number;
  readonly to: number;
  readonly height: number;
}

export const DOORS: Readonly<Record<'dining' | 'walkIn' | 'back', Door>> = {
  /** Double swinging doors to the dining room, in the south wall. */
  dining: { wall: 'south', from: -1.3, to: 1.3, height: 2.3 },
  /** Walk-in cooler, in the east wall behind the garde manger. */
  walkIn: { wall: 'east', from: -3.9, to: -2.1, height: 2.2 },
  /** Back door with an exit sign, in the west wall. */
  back: { wall: 'west', from: 2.2, to: 3.8, height: 2.2 },
};

/** A strip of windows in the north wall, over the window counter, looking out on the garden. */
export const WINDOWS = {
  from: -6.5,
  to: 6.5,
  bottom: 1.35,
  top: 2.75,
  /** Mullions divide the strip into this many panes. */
  panes: 10,
} as const;

// ---------- The walk-in cooler ----------
//
// Behind the walk-in's door in the east wall is a real cold room. The door stays shut until enough
// hits burst it open (see cooler.ts); after that its doorway is open to walk and throw through, and
// the cold room's walls stop players and knives. The kitchen's walls are colliders like any
// fixture, so the doorway is simply a gap in the east wall: plugged by the door while it is shut.

/** How thick the east wall is around the walk-in's doorway. */
export const COOLER_WALL = 0.2;

/**
 * The cold room's inside: a box behind the east wall, as long as the walk-in door is from the north
 * wall and running back from it. Its south wall lines up with the south side of the doorway, so the
 * door swings in flat against it.
 */
export const COOLER = {
  minX: ROOM_HALF_X + COOLER_WALL,
  maxX: ROOM_HALF_X + COOLER_WALL + 3.4,
  minZ: -6.1,
  maxZ: DOORS.walkIn.to,
  /** A walk-in's ceiling is low, well under the kitchen's vault. */
  height: 2.6,
} as const;

/**
 * The walk-in's door: a heavy slab in the doorway, its kitchen face flush with the wall (where
 * punches and knives meet it). It is hinged at the back of its south edge, so it swings in, into the
 * cooler, and lies flat against the cooler's south wall once open. Across the wall it runs a
 * centimeter past the opening on either side, behind the frame.
 */
export const COOLER_DOOR = {
  /** The face the kitchen sees. */
  face: ROOM_HALF_X,
  thickness: 0.1,
  from: DOORS.walkIn.from - 0.01,
  to: DOORS.walkIn.to + 0.01,
  bottom: 0.01,
  top: DOORS.walkIn.height - 0.005,
  /** The hinge axis, upright, at the back of the door's south edge. */
  hingeX: ROOM_HALF_X + 0.1,
  hingeZ: DOORS.walkIn.to + 0.01,
} as const;

/** Empty wire shelving along the cooler's walls, waiting to be filled. */
export const COOLER_SHELVES: readonly Fixture[] = [
  { minX: COOLER.minX + 0.25, maxX: COOLER.minX + 1.65, minZ: COOLER.minZ, maxZ: -5.6, top: 1.85 },
  { minX: COOLER.maxX - 1.55, maxX: COOLER.maxX - 0.15, minZ: COOLER.minZ, maxZ: -5.6, top: 1.85 },
  { minX: COOLER.maxX - 0.48, maxX: COOLER.maxX, minZ: -5.3, maxZ: -3.9, top: 1.85 },
];

/** The kitchen's walls as colliders are this thick wherever nothing lies behind them. */
const WALL_COLLIDER = 1;
/** Walls reach far above anyone's head, however they jump. */
const WALL_COLLIDER_TOP = 10;

function wallCollider(
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  bottom = -1,
  top = WALL_COLLIDER_TOP,
): BoxCollider {
  return { kind: 'box', minX, maxX, minZ, maxZ, bottom, top };
}

const DOORWAY = DOORS.walkIn;

/**
 * The kitchen's four walls, with a gap in the east wall for the walk-in's doorway. The east wall is
 * only as thick as it really is north of the doorway, where the cooler lies behind it.
 */
const KITCHEN_WALLS: readonly BoxCollider[] = [
  wallCollider(
    -ROOM_HALF_X - WALL_COLLIDER,
    ROOM_HALF_X + WALL_COLLIDER,
    -ROOM_HALF_Z - WALL_COLLIDER,
    -ROOM_HALF_Z,
  ),
  wallCollider(
    -ROOM_HALF_X - WALL_COLLIDER,
    ROOM_HALF_X + WALL_COLLIDER,
    ROOM_HALF_Z,
    ROOM_HALF_Z + WALL_COLLIDER,
  ),
  wallCollider(
    -ROOM_HALF_X - WALL_COLLIDER,
    -ROOM_HALF_X,
    -ROOM_HALF_Z - WALL_COLLIDER,
    ROOM_HALF_Z + WALL_COLLIDER,
  ),
  wallCollider(ROOM_HALF_X, COOLER.minX, -ROOM_HALF_Z - WALL_COLLIDER, DOORWAY.from),
  wallCollider(ROOM_HALF_X, ROOM_HALF_X + WALL_COLLIDER, DOORWAY.to, ROOM_HALF_Z + WALL_COLLIDER),
];

/** The shut door, filling the doorway through the wall's whole thickness. */
const SHUT_DOOR: BoxCollider = wallCollider(ROOM_HALF_X, COOLER.minX, DOORWAY.from, DOORWAY.to);

/** With the door open: the doorway's lintel, the cold room's walls and ceiling, and the open door. */
const OPEN_COOLER: readonly BoxCollider[] = [
  wallCollider(ROOM_HALF_X, COOLER.minX, DOORWAY.from, DOORWAY.to, DOORWAY.height),
  wallCollider(COOLER.minX, COOLER.maxX + WALL_COLLIDER, COOLER.minZ - WALL_COLLIDER, COOLER.minZ),
  wallCollider(
    COOLER.maxX,
    COOLER.maxX + WALL_COLLIDER,
    COOLER.minZ - WALL_COLLIDER,
    COOLER.maxZ + WALL_COLLIDER,
  ),
  wallCollider(COOLER.minX, COOLER.maxX + WALL_COLLIDER, COOLER.maxZ, COOLER.maxZ + WALL_COLLIDER),
  wallCollider(COOLER.minX, COOLER.maxX, COOLER.minZ, COOLER.maxZ, COOLER.height),
  ...COOLER_SHELVES.map((f) =>
    wallCollider(f.minX, f.maxX, f.minZ, f.maxZ, -1, FIXTURE_COLLIDER_TOP),
  ),
  // The door, swung in flat against the south wall.
  wallCollider(
    COOLER_DOOR.hingeX,
    COOLER_DOOR.hingeX + (COOLER_DOOR.to - COOLER_DOOR.from),
    COOLER_DOOR.hingeZ - COOLER_DOOR.thickness,
    COOLER.maxZ,
    -1,
    COOLER_DOOR.top,
  ),
];

/** Player centers stay inside this box whatever happens: the kitchen and the cooler beside it. */
export const PLAY_BOUNDS: Footprint = {
  minX: -PLAY_HALF_X,
  maxX: COOLER.maxX - PLAYER_RADIUS,
  minZ: -PLAY_HALF_Z,
  maxZ: PLAY_HALF_Z,
};

/**
 * Whether a player may stand at (x, z): in the kitchen, or, with the walk-in open, in its doorway
 * or the cooler. For placing players (spawn hints), not for moving them.
 */
export function inPlayArea(x: number, z: number, coolerOpen: boolean): boolean {
  const e = 1e-6;
  if (Math.abs(x) <= PLAY_HALF_X + e && Math.abs(z) <= PLAY_HALF_Z + e) return true;
  if (!coolerOpen) return false;
  const doorway =
    x <= COOLER.minX + PLAYER_RADIUS + e &&
    z >= DOORWAY.from + PLAYER_RADIUS - e &&
    z <= COOLER_DOOR.hingeZ - COOLER_DOOR.thickness - PLAYER_RADIUS + e;
  const cooler =
    x >= COOLER.minX + PLAYER_RADIUS - e &&
    x <= COOLER.maxX - PLAYER_RADIUS + e &&
    z >= COOLER.minZ + PLAYER_RADIUS - e &&
    z <= COOLER_DOOR.hingeZ - COOLER_DOOR.thickness - PLAYER_RADIUS + e;
  return x > 0 && (doorway || cooler);
}

/**
 * What a thrown knife can stick into once the walk-in is open, besides the floor: the wall around
 * the doorway, the cold room's walls and ceiling, and the open door. While the door is shut the
 * kitchen's east wall stops every knife, the door included.
 */
export const COOLER_KNIFE_SOLIDS: readonly BoxCollider[] = [
  // The wall north of the doorway and over it, between the kitchen and the cold room.
  wallCollider(ROOM_HALF_X, COOLER.minX, COOLER.minZ - COOLER_WALL, DOORWAY.from, 0, COOLER.height),
  wallCollider(ROOM_HALF_X, COOLER.minX, DOORWAY.from, DOORWAY.to, DOORWAY.height, COOLER.height),
  // The cold room's walls and ceiling, a wall's thickness each.
  wallCollider(
    ROOM_HALF_X,
    COOLER.maxX + COOLER_WALL,
    COOLER.minZ - COOLER_WALL,
    COOLER.minZ,
    0,
    COOLER.height,
  ),
  wallCollider(
    COOLER.maxX,
    COOLER.maxX + COOLER_WALL,
    COOLER.minZ - COOLER_WALL,
    COOLER.maxZ + COOLER_WALL,
    0,
    COOLER.height,
  ),
  wallCollider(
    ROOM_HALF_X,
    COOLER.maxX + COOLER_WALL,
    COOLER.maxZ,
    COOLER.maxZ + COOLER_WALL,
    0,
    COOLER.height,
  ),
  wallCollider(
    ROOM_HALF_X,
    COOLER.maxX + COOLER_WALL,
    COOLER.minZ - COOLER_WALL,
    COOLER.maxZ + COOLER_WALL,
    COOLER.height,
    COOLER.height + COOLER_WALL,
  ),
  // The open door.
  wallCollider(
    COOLER_DOOR.hingeX,
    COOLER_DOOR.hingeX + (COOLER_DOOR.to - COOLER_DOOR.from),
    COOLER_DOOR.hingeZ - COOLER_DOOR.thickness,
    COOLER.maxZ,
    COOLER_DOOR.bottom,
    COOLER_DOOR.top,
  ),
];

/** Whether a knife crossing the east wall's plane at (y, z) goes on into the open doorway. */
export function inCoolerDoorway(y: number, z: number): boolean {
  return y >= 0 && y <= DOORWAY.height && z >= DOORWAY.from && z <= DOORWAY.to;
}

/**
 * Whether the wall between the kitchen and the cooler hides (bx, by, bz) from (ax, ay, az): a sight
 * line from one to the other passes beside the doorway, or the door is shut. Nothing else in the
 * kitchen hides anything from anyone, for labels and picking.
 */
export function coolerWallBetween(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  coolerOpen: boolean,
): boolean {
  if (ax > ROOM_HALF_X === bx > ROOM_HALF_X) return false;
  if (!coolerOpen) return true;
  // Through both faces of the wall, inside the doorway. Labels ask every frame: no allocations.
  return (
    crossesBesideDoorway(ROOM_HALF_X, ax, ay, az, bx, by, bz) ||
    crossesBesideDoorway(COOLER.minX, ax, ay, az, bx, by, bz)
  );
}

/**
 * How far a ray from (ox, oy, oz) along the unit (dx, dy, dz) gets before the wall between the
 * kitchen and the cooler stops it: to the first face it meets beside the doorway (anywhere, with the
 * door shut), or `reach` if it gets that far first. What is in front of the wall can be picked and
 * what is behind it cannot, however far the ray would have gone. Picking asks every frame: no
 * allocations.
 */
export function coolerWallReach(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  reach: number,
  coolerOpen: boolean,
): number {
  return Math.min(
    faceReach(ROOM_HALF_X, ox, oy, oz, dx, dy, dz, reach, coolerOpen),
    faceReach(COOLER.minX, ox, oy, oz, dx, dy, dz, reach, coolerOpen),
  );
}

/** How far along the ray it meets the face x = `plane` and is stopped there, else `reach`. */
function faceReach(
  plane: number,
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  reach: number,
  coolerOpen: boolean,
): number {
  if (dx === 0) return reach;
  const t = (plane - ox) / dx;
  if (t < 0 || t > reach) return reach;
  return coolerOpen && inCoolerDoorway(oy + dy * t, oz + dz * t) ? reach : t;
}

/** Whether a segment crosses the plane x = `plane` outside the walk-in's doorway. */
function crossesBesideDoorway(
  plane: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
): boolean {
  const t = (plane - ax) / (bx - ax);
  if (t < 0 || t > 1) return false;
  return !inCoolerDoorway(ay + (by - ay) * t, az + (bz - az) * t);
}

export type StationId =
  | 'passe'
  | 'saucier'
  | 'poissonnier'
  | 'rotisseur'
  | 'entremetier'
  | 'garde-manger'
  | 'patisserie'
  | 'plonge';

export interface Station {
  readonly id: StationId;
  /** The middle of the station's centerpiece: where it is picked, and where its label hangs. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** How close the crosshair ray must pass to the center to pick the station. */
  readonly radius: number;
}

const PIANO_ROW = 0.75;
const ON_COUNTER = COUNTER_HEIGHT + 0.25;

/** The eight stations of the brigade. Each one is clickable. */
export const STATIONS: readonly Station[] = [
  { id: 'entremetier', x: -2.6, y: ON_COUNTER, z: PIANO_ROW, radius: 0.75 },
  { id: 'rotisseur', x: 2.6, y: ON_COUNTER, z: PIANO_ROW, radius: 0.75 },
  { id: 'saucier', x: -2.6, y: ON_COUNTER, z: -PIANO_ROW, radius: 0.75 },
  { id: 'poissonnier', x: 2.6, y: ON_COUNTER, z: -PIANO_ROW, radius: 0.75 },
  { id: 'passe', x: 0, y: COUNTER_HEIGHT + 0.35, z: 4.3, radius: 1.0 },
  { id: 'garde-manger', x: 3.2, y: ON_COUNTER, z: -4.2, radius: 0.8 },
  { id: 'patisserie', x: -3.2, y: COUNTER_HEIGHT + 0.4, z: -4.2, radius: 0.85 },
  { id: 'plonge', x: 7.2, y: ON_COUNTER, z: 6.15, radius: 0.8 },
];

/**
 * The kitchen computer on the chef's desk: an old beige PC that runs DOOM. Like a station it is
 * picked by the crosshair; `x, y, z` is the middle of its screen, which faces east, into the room.
 */
export const COMPUTER = {
  x: KITCHEN.desk.minX + 0.38,
  y: KITCHEN.desk.top + 0.27,
  z: (KITCHEN.desk.minZ + KITCHEN.desk.maxZ) / 2,
  radius: 0.3,
} as const;

export type DishId = 'char-siu' | 'beetroot' | 'roti' | 'ricotta-toast' | 'truffle-croissant';

/** A plate on the pass. Like a station it can be clicked, and it wins over the pass around it. */
export interface Dish {
  readonly id: DishId;
  /** The middle of the plate's food: where it is picked. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** How close the crosshair ray must pass to the center to pick the dish. */
  readonly radius: number;
}

const PASS_MIDDLE = (KITCHEN.pass.minZ + KITCHEN.pass.maxZ) / 2;
const ON_PASS = KITCHEN.pass.top + 0.06;

/** Daniel's five favorite dishes, waiting on the pass, left to right as seen from the dining room. */
export const PASS_DISHES: readonly Dish[] = [
  { id: 'char-siu', x: -3, y: ON_PASS, z: PASS_MIDDLE, radius: 0.24 },
  { id: 'beetroot', x: -1.5, y: ON_PASS, z: PASS_MIDDLE, radius: 0.24 },
  { id: 'roti', x: 0, y: ON_PASS, z: PASS_MIDDLE, radius: 0.24 },
  { id: 'ricotta-toast', x: 1.5, y: ON_PASS, z: PASS_MIDDLE, radius: 0.24 },
  { id: 'truffle-croissant', x: 3, y: ON_PASS, z: PASS_MIDDLE, radius: 0.24 },
];

/**
 * First player in a room stands here, at the chef's side of the pass by the dining room doors,
 * facing north across the pass and the piano to the windows.
 */
export const SPAWN = { x: 0, z: 5.6, yaw: 0 } as const;

/** Later arrivals are spread along the aisle, this wide in total. */
const SPAWN_SPREAD = 8;

/**
 * A spawn spot in the aisle, facing the piano. `t` in [0, 1) picks the spot; t = 0 is SPAWN.
 * New players are spread out so a busy room does not stack everyone on one point.
 */
export function spawnPoint(t: number): { x: number; z: number; yaw: number } {
  const offset = (((t % 1) + 1.5) % 1) - 0.5;
  // Round away floating point noise so t = 0 is exactly SPAWN.
  const x = Math.round(offset * SPAWN_SPREAD * 1e6) / 1e6 + 0;
  return { x: SPAWN.x + x, z: SPAWN.z, yaw: SPAWN.yaw };
}

function buildColliders(): Collider[] {
  const colliders: Collider[] = [];
  for (const fixture of Object.values(KITCHEN)) {
    const { minX, maxX, minZ, maxZ } = fixture;
    if ('bottom' in fixture) {
      colliders.push({
        kind: 'box',
        minX,
        maxX,
        minZ,
        maxZ,
        bottom: fixture.bottom,
        top: fixture.top,
      });
    } else {
      const top = Math.max(fixture.top, FIXTURE_COLLIDER_TOP);
      colliders.push({ kind: 'box', minX, maxX, minZ, maxZ, bottom: -1, top });
    }
  }
  return colliders;
}

/**
 * Everything a player bumps into while the walk-in is shut: the fixtures, the walls, and the door.
 * `coolerColliders(true)` has the doorway open and the cold room behind it instead.
 */
export const COLLIDERS: readonly Collider[] = [...buildColliders(), ...KITCHEN_WALLS, SHUT_DOOR];

/** Everything a player bumps into once the walk-in is open: its doorway is open, its room solid. */
export const OPEN_COOLER_COLLIDERS: readonly Collider[] = [
  ...buildColliders(),
  ...KITCHEN_WALLS,
  ...OPEN_COOLER,
];

/** What players collide with, with the walk-in shut or open. */
export function coolerColliders(open: boolean): readonly Collider[] {
  return open ? OPEN_COOLER_COLLIDERS : COLLIDERS;
}

/** How far the barrel vault rises above the top of the walls. */
export const VAULT_RISE = 1.8;
const VAULT_RADIUS = (ROOM_HALF_Z * ROOM_HALF_Z + VAULT_RISE * VAULT_RISE) / (2 * VAULT_RISE);

/** Height of the barrel vault above the floor at a given z. */
export function vaultHeight(z: number): number {
  return ROOM_HEIGHT + Math.sqrt(VAULT_RADIUS * VAULT_RADIUS - z * z) - (VAULT_RADIUS - VAULT_RISE);
}

// ---------------------------------------------------------------------------------------------
// Knife solids
//
// A thrown knife sticks into the floor, the walls and the vault (see knife.ts), and into the solids
// below, drawn tight round what the kitchen shows, so a stuck knife sits in the surface it hit and
// never hangs in the air beside it. They are not the movement colliders, which reach far above the
// counters to keep cooks off them; players move exactly as before.
//
// Most of them mirror the boxes and cylinders the client draws in `kitchen.ts`, `props.ts` and
// `computer.ts`, in the same order and with the same numbers; the client's `knifeSolids.test.ts`
// throws thousands of knives at the drawn kitchen and fails if one passes through anything sizable
// or sticks short of it. What has to be drawn and solid the same way and is more than a box (the
// lamp shades, the skylights, the plates stacked on the islands) is defined here and drawn from.
// ---------------------------------------------------------------------------------------------

/** A radius at a height, on the outline of something round. */
export type Ring = readonly [radius: number, y: number];

/**
 * A lamp shade's outline from the rim up, in its own frame: the outside, and the hollow under it,
 * which is open at the rim, so a knife can fly up into the shade and stick in its inside.
 */
export interface ShadeOutline {
  readonly outside: readonly Ring[];
  readonly inside: readonly Ring[];
}

/** The wide brass domes over the islands, with a thin wall so they read from above and below. */
export const PENDANT_SHADE: ShadeOutline = {
  outside: [
    [0.25, 0],
    [0.17, 0.14],
    [0.05, 0.2],
  ],
  inside: [
    [0.24, 0],
    [0.16, 0.13],
    [0.045, 0.19],
  ],
};

/** The steel cones of the heat lamps over the pass. */
export const HEAT_LAMP_SHADE: ShadeOutline = {
  outside: [
    [0.14, 0],
    [0.05, 0.15],
  ],
  inside: [
    [0.132, 0],
    [0.045, 0.14],
  ],
};

/**
 * The middle of each pendant shade's rim: a pair along each island, high enough to clear any head,
 * even mid-jump.
 */
export const PENDANT_LAMPS: readonly {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}[] = [KITCHEN.pastryIsland, KITCHEN.gardeManger].flatMap((f) => {
  const cx = (f.minX + f.maxX) / 2;
  const cz = (f.minZ + f.maxZ) / 2;
  return [-1, 1].map((side) => ({ x: cx + side * 1.05, y: 2.95, z: cz }));
});

/** The bottom of the heat lamp housing over the pass; a lamp hangs under it over each dish. */
export const HEAT_LAMP_HOUSING_Y = 2.18;

/** The garden windows' glass is set back this far into the north wall. */
export const WINDOW_GLASS_DEPTH = 0.1;

/** The barrel vault is built of this many flat facets, north to south. */
export const VAULT_FACETS = 12;

/** Where the vault's facets meet, north to south, on the curve of `vaultHeight`. */
export const VAULT_EDGES: readonly { readonly z: number; readonly y: number }[] = Array.from(
  { length: VAULT_FACETS + 1 },
  (_, i) => {
    const maxAngle = Math.asin(ROOM_HALF_Z / VAULT_RADIUS);
    const angle = -maxAngle + (i / VAULT_FACETS) * maxAngle * 2;
    const z =
      i === 0 ? -ROOM_HALF_Z : i === VAULT_FACETS ? ROOM_HALF_Z : VAULT_RADIUS * Math.sin(angle);
    return { z, y: vaultHeight(z) };
  },
);

/**
 * The two skylights: the vault facets over the aisles either side of the hood, open across the
 * middle of the room. Each is a shallow well out through the vault, glazed near its top, with
 * glazing bars just under the glass.
 */
export const SKYLIGHTS = {
  facets: [2, VAULT_FACETS - 3],
  /** Half the length of each opening, along the room. */
  halfLength: 6,
  /** How far each well reaches out of the vault, and where its glass is. */
  depth: 0.22,
  glass: 0.18,
  /** The bars divide each skylight into this many panes; their square section is `bar` across. */
  panes: 6,
  bar: 0.05,
  /** How far out of the vault the bars' middle is. */
  barDepth: 0.15,
} as const;

/** A skylight's well, in the frame it is built in. */
export interface SkylightWell {
  /** Its north and south edges, where it opens out of the vault. */
  readonly a: { readonly z: number; readonly y: number };
  readonly b: { readonly z: number; readonly y: number };
  /** Out of the vault: a unit vector, in z and y, along which the well's walls run. */
  readonly out: { readonly z: number; readonly y: number };
}

export const SKYLIGHT_WELLS: readonly SkylightWell[] = SKYLIGHTS.facets.map((i) => {
  const a = VAULT_EDGES[i]!;
  const b = VAULT_EDGES[i + 1]!;
  const outZ = (a.z + b.z) / 2 / VAULT_RADIUS;
  const length = Math.sqrt(1 + outZ * outZ);
  return { a, b, out: { z: outZ / length, y: 1 / length } };
});

/** The island shelves' heights; each is 2.5 cm of steel, with plates and bowls stacked on it. */
export const ISLAND_SHELVES = [0.16, 0.5] as const;
const ISLAND_SHELF = 0.025;

/** What is stacked on the island shelves: plates, and deeper bowls that flare toward the top. */
export const STACKED = {
  plate: { radius: 0.14, height: 0.014, step: 0.018, taper: 1 },
  bowl: { radius: 0.11, height: 0.05, step: 0.03, taper: 1.4 },
} as const;

/** A stack of plates or bowls on an island shelf, standing on (x, y, z). */
export interface PlateStack {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly count: number;
  readonly bowls: boolean;
}

/** The plates and bowls on an island's two shelves, the same on every screen. */
export function islandStacks(f: Footprint): readonly PlateStack[] {
  const random = createRandom(Math.round((f.minX + 10) * 100));
  const z = (f.minZ + f.maxZ) / 2;
  const stacks: PlateStack[] = [];
  for (const shelf of ISLAND_SHELVES) {
    for (let x = f.minX + 0.45; x < f.maxX - 0.3; x += 0.75) {
      const count = 4 + Math.floor(random() * 6);
      const bowls = random() < 0.4;
      stacks.push({ x, y: shelf + ISLAND_SHELF, z, count, bowls });
    }
  }
  return stacks;
}

/** The storage shelving's wire shelves: the top of each, from the floor up. */
export const SHELVING_SHELVES = [0.3, 0.85, 1.4, 1.95] as const;

/**
 * Something on the storage shelving: a clear tub (with a filling picked by `pick`, in [0, 1)) or a
 * pair of stacked deli containers, standing on a shelf at height `y`, centered at `z`.
 */
export interface ShelfBin {
  readonly kind: 'tub' | 'deli';
  readonly y: number;
  readonly z: number;
  readonly pick: number;
}

/** What stands on the storage shelving, the same on every screen. The top shelf is kept clear. */
export function shelvingBins(): readonly ShelfBin[] {
  const s = KITCHEN.shelving;
  const random = createRandom(55);
  const bins: ShelfBin[] = [];
  for (const y of SHELVING_SHELVES) {
    if (y > 1.9) continue;
    for (let z = s.minZ + 0.3; z < s.maxZ - 0.2; z += 0.5) {
      if (random() < 0.5) bins.push({ kind: 'tub', y, z, pick: random() });
      else bins.push({ kind: 'deli', y, z, pick: 0 });
    }
  }
  return bins;
}

/**
 * A round solid on a vertical axis: a pot, a lamp shade, a dome. Its outline is a stack of rings
 * from the bottom up, each section between two rings a cone frustum, and must be convex. A lamp
 * shade has a `hollow`: the outline of the space under it, open at the bottom, from the same bottom
 * height. An oval pan is round with its depth along z squashed by `depthScale`.
 */
export interface RoundSolid {
  readonly kind: 'round';
  readonly x: number;
  readonly z: number;
  readonly rings: readonly Ring[];
  readonly hollow: readonly Ring[] | null;
  readonly depthScale: number;
  /** Its bounds; every knife solid has them, so a knife can pass most of them at a glance. */
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly bottom: number;
  readonly top: number;
}

export type KnifeSolid = BoxCollider | RoundSolid;

/** A box by its extents, in the order `Kit.box` takes them: x, then y, then z. */
function box(
  minX: number,
  maxX: number,
  bottom: number,
  top: number,
  minZ: number,
  maxZ: number,
): BoxCollider {
  return { kind: 'box', minX, maxX, minZ, maxZ, bottom, top };
}

/** A box centered on (x, y, z), w wide, h tall and d deep, like `Kit.boxAt`. */
function boxAt(x: number, y: number, z: number, w: number, h: number, d: number): BoxCollider {
  return box(x - w / 2, x + w / 2, y - h / 2, y + h / 2, z - d / 2, z + d / 2);
}

/**
 * A box with its edges chamfered by `radius`, like `Kit.rounded`: drawn in a little from its faces,
 * so it sits under a knife within a centimeter or two at the middle of a face and at a chamfer alike.
 */
function rounded(
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  radius: number,
): BoxCollider {
  const inset = radius * 0.6;
  return boxAt(x, y, z, w - inset, h - inset, d - inset);
}

function round(
  x: number,
  z: number,
  rings: readonly Ring[],
  depthScale = 1,
  hollow: readonly Ring[] | null = null,
): RoundSolid {
  const reach = Math.max(...rings.map(([radius]) => radius));
  return {
    kind: 'round',
    x,
    z,
    rings,
    hollow,
    depthScale,
    minX: x - reach,
    maxX: x + reach,
    minZ: z - reach * depthScale,
    maxZ: z + reach * depthScale,
    bottom: rings[0]![1],
    top: rings[rings.length - 1]![1],
  };
}

/** A cylinder standing on (x, y, z), like `Kit.cylinder`; `taper` is its top radius over its bottom one. */
function cylinder(
  x: number,
  y: number,
  z: number,
  radius: number,
  height: number,
  taper = 1,
  depthScale = 1,
): RoundSolid {
  return round(
    x,
    z,
    [
      [radius, y],
      [radius * taper, y + height],
    ],
    depthScale,
  );
}

/** Heights up a quarter of an ellipse, as fractions of its height: the sines of 0, 22.5, 45, 67.5 and 90 degrees. */
const QUARTER = [0, 0.3827, 0.7071, 0.9239, 1];

/**
 * An ellipsoid centered on (x, y, z) with semi-axes rx, ry and rz, like `Kit.sphere` stretched; or
 * only its top half, a dome on whatever it stands on.
 */
function ellipsoid(
  x: number,
  y: number,
  z: number,
  rx: number,
  ry: number,
  rz: number,
  dome = false,
): RoundSolid {
  const up = QUARTER.map((s): Ring => [rx * Math.sqrt(1 - s * s), y + ry * s]);
  const down = QUARTER.slice(1)
    .reverse()
    .map((s): Ring => [rx * Math.sqrt(1 - s * s), y - ry * s]);
  return round(x, z, dome ? up : [...down, ...up], rz / rx);
}

/** A lamp shade whose rim is centered on (x, y, z). */
function shade(x: number, y: number, z: number, outline: ShadeOutline): RoundSolid {
  const place = (rings: readonly Ring[]) => rings.map(([radius, h]): Ring => [radius, y + h]);
  return round(x, z, place(outline.outside), 1, place(outline.inside));
}

const TOP = COUNTER_HEIGHT;
/** Work surfaces are 6 cm slabs. */
const SLAB = 0.06;
const HX = ROOM_HALF_X;
const HZ = ROOM_HALF_Z;

/** The room's trim: the cove at the floor, the light lines under the vault, and the nameplate. */
function shellSolids(): KnifeSolid[] {
  const signY = (WINDOWS.top + ROOM_HEIGHT - 0.08) / 2;
  const line = ROOM_HEIGHT - 0.06;
  return [
    box(-HX, HX, 0, 0.1, -HZ, -HZ + 0.02),
    box(-HX, HX, 0, 0.1, HZ - 0.02, HZ),
    // The east wall's cove stops at the walk-in's doorway.
    box(HX - 0.02, HX, 0, 0.1, -HZ, DOORS.walkIn.from),
    box(HX - 0.02, HX, 0, 0.1, DOORS.walkIn.to, HZ),
    box(-HX, -HX + 0.02, 0, 0.1, -HZ, HZ),
    box(-HX, HX, line, line + 0.04, -HZ, -HZ + 0.05),
    box(-HX, HX, line, line + 0.04, HZ - 0.05, HZ),
    // Every Second Counts, on the wall over the windows, between its two rails.
    box(-1.1, 1.1, signY - 0.25, signY + 0.25, -HZ, -HZ + 0.012),
    ...[-1, 1].map((side) => {
      const y = signY + side * 0.265;
      return box(-1.13, 1.13, y - 0.022, y + 0.022, -HZ, -HZ + 0.03);
    }),
  ];
}

/**
 * The dining room doors in their steel frame, the clock over them, the back door under its exit
 * sign, and the walk-in's steel frame and the controller beside it (coolerRoom.ts). The walk-in's
 * door is the cooler's: its kitchen face is flush with the wall, which stops knives while it is
 * shut, and `COOLER_KNIFE_SOLIDS` has it once it is open.
 */
function doorSolids(): KnifeSolid[] {
  const walkIn = DOORS.walkIn;
  const casing = 0.12;
  const controller = { y: 1.6, z: walkIn.from - 0.34 };
  const { from, to, height } = DOORS.dining;
  const lintel = height + 0.12;
  const clock = { x: (from + to) / 2, y: lintel + 0.22 + 0.235 };
  const back = DOORS.back;
  const exitSign = { z: (back.from + back.to) / 2, y: back.height + 0.32 };
  return [
    box(from - 0.1, to + 0.1, height, lintel, HZ - 0.06, HZ),
    box(from - 0.1, from, 0, height, HZ - 0.06, HZ),
    box(to, to + 0.1, 0, height, HZ - 0.06, HZ),
    box(from, -0.015, 0.03, height - 0.02, HZ - 0.045, HZ),
    box(0.015, to, 0.03, height - 0.02, HZ - 0.045, HZ),
    box(clock.x - 0.75, clock.x + 0.75, clock.y - 0.235, clock.y + 0.235, HZ - 0.06, HZ),
    box(-HX, -HX + 0.04, 0, back.height + 0.08, back.from - 0.08, back.to + 0.08),
    box(-HX, -HX + 0.08, 0.02, back.height, back.from, back.to),
    box(
      -HX,
      -HX + 0.08,
      exitSign.y - 0.11,
      exitSign.y + 0.11,
      exitSign.z - 0.28,
      exitSign.z + 0.28,
    ),
    box(HX - 0.05, HX, 0, walkIn.height + casing, walkIn.from - casing, walkIn.from),
    box(HX - 0.05, HX, 0, walkIn.height + casing, walkIn.to, walkIn.to + casing),
    box(HX - 0.05, HX, walkIn.height, walkIn.height + casing, walkIn.from, walkIn.to),
    box(
      HX - 0.05,
      HX,
      controller.y - 0.06,
      controller.y + 0.06,
      controller.z - 0.11,
      controller.z + 0.11,
    ),
  ];
}

/** A counter: a body on a recessed plinth, under a work surface that overhangs it a little. */
function counterSolids(f: Fixture): KnifeSolid[] {
  return [
    box(f.minX + 0.05, f.maxX - 0.05, 0, 0.1, f.minZ + 0.05, f.maxZ - 0.05),
    box(f.minX, f.maxX, 0.1, TOP - SLAB, f.minZ, f.maxZ),
    box(f.minX - 0.02, f.maxX + 0.02, TOP - SLAB, TOP, f.minZ - 0.02, f.maxZ + 0.02),
  ];
}

/** The cooking suite, its oven doors, and the high shelf down its spine with plates on it. */
function pianoSolids(): KnifeSolid[] {
  const p = KITCHEN.piano;
  const shelf = 1.5;
  const plates = STACKED.plate;
  return [
    box(p.minX + 0.06, p.maxX - 0.06, 0, 0.12, p.minZ + 0.06, p.maxZ - 0.06),
    box(p.minX, p.maxX, 0.12, TOP - SLAB - 0.04, p.minZ, p.maxZ),
    box(p.minX - 0.04, p.maxX + 0.04, TOP - SLAB - 0.04, TOP, p.minZ - 0.04, p.maxZ + 0.04),
    ...[-1, 1].flatMap((side) =>
      [-3.6, -1.2, 1.2, 3.6].map((x) => boxAt(x, 0.45, side * (p.maxZ + 0.012), 2.1, 0.5, 0.03)),
    ),
    // The cast iron cooking zones on the steel top, a centimeter proud of it.
    ...[-1, 1].flatMap((side) => [
      box(1.55, 3.65, TOP, TOP + 0.01, side < 0 ? -1.3 : 0.12, side < 0 ? -0.12 : 1.3),
      box(-3.65, -1.55, TOP, TOP + 0.01, side < 0 ? -1.3 : 0.12, side < 0 ? -0.12 : 1.3),
    ]),
    box(-1.35, 1.35, TOP, TOP + 0.01, -1.3, 1.3),
    box(-4.2, 4.2, shelf, shelf + 0.03, -0.2, 0.2),
    ...[-4.1, -1.6, 1.6, 4.1].map((x) => box(x - 0.02, x + 0.02, TOP, shelf, -0.02, 0.02)),
    ...[
      [-3.4, 7],
      [3.3, 5],
    ].map(([x, count]) =>
      cylinder(x!, shelf + 0.03, 0, plates.radius, (count! - 1) * plates.step + plates.height),
    ),
  ];
}

/** The hood: a 4 cm steel skirt round an open, lit underside, boxed up into the vault, and its plaques. */
function hoodSolids(): KnifeSolid[] {
  const h = KITCHEN.hood;
  const skirt = h.top - 0.05;
  const t = 0.04;
  return [
    box(h.minX, h.maxX, h.bottom, skirt, h.minZ, h.minZ + t),
    box(h.minX, h.maxX, h.bottom, skirt, h.maxZ - t, h.maxZ),
    box(h.minX, h.minX + t, h.bottom, skirt, h.minZ, h.maxZ),
    box(h.maxX - t, h.maxX, h.bottom, skirt, h.minZ, h.maxZ),
    box(h.minX, h.maxX, skirt, vaultHeight(0) + 0.05, h.minZ, h.maxZ),
    ...[-0.75, 0, 0.75].flatMap((x) => [
      boxAt(x, 4.0, h.minZ - 0.015, 0.42, 0.42, 0.03),
      // The star on it, 13 cm to its points.
      box(x - 0.124, x + 0.124, 3.895, 4.13, h.minZ - 0.045, h.minZ - 0.03),
    ]),
  ];
}

/** The pass, and the gantry over it: two posts, the lamp housing, and a heat lamp over each dish. */
function passSolids(): KnifeSolid[] {
  const p = KITCHEN.pass;
  const cz = (p.minZ + p.maxZ) / 2;
  const housing = HEAT_LAMP_HOUSING_Y;
  return [
    ...counterSolids(p),
    ...[p.minX + 0.2, p.maxX - 0.2].map((x) => cylinder(x, TOP, cz, 0.028, housing + 0.12 - TOP)),
    box(p.minX + 0.1, p.maxX - 0.1, housing, housing + 0.12, cz - 0.18, cz + 0.18),
    ...PASS_DISHES.flatMap(({ x }) => [
      shade(x, housing - 0.15, cz, HEAT_LAMP_SHADE),
      ellipsoid(x, housing - 0.13, cz, 0.06, 0.042, 0.06),
    ]),
  ];
}

/** A prep island: a charcoal top on a steel apron and legs, open shelves, and the plates on them. */
function islandSolids(f: Fixture): KnifeSolid[] {
  const legs: KnifeSolid[] = [];
  for (const x of [f.minX + 0.06, f.maxX - 0.06]) {
    for (const z of [f.minZ + 0.06, f.maxZ - 0.06]) {
      legs.push(box(x - 0.025, x + 0.025, 0, TOP - SLAB, z - 0.025, z + 0.025));
    }
  }
  return [
    box(f.minX - 0.04, f.maxX + 0.04, TOP - SLAB, TOP, f.minZ - 0.04, f.maxZ + 0.04),
    box(f.minX + 0.03, f.maxX - 0.03, TOP - SLAB - 0.08, TOP - SLAB, f.minZ + 0.03, f.maxZ - 0.03),
    ...ISLAND_SHELVES.map((y) =>
      box(f.minX + 0.05, f.maxX - 0.05, y, y + ISLAND_SHELF, f.minZ + 0.05, f.maxZ - 0.05),
    ),
    ...legs,
    ...islandStacks(f).map(({ x, y, z, count, bowls }) => {
      const { radius, height, step, taper } = bowls ? STACKED.bowl : STACKED.plate;
      const top = y + (count - 1) * step + height;
      return round(x, z, [
        [radius, y],
        [radius * taper, y + height],
        [radius * taper, top],
      ]);
    }),
  ];
}

/** The pendant lamps over the islands: each brass shade and the bulb inside it. Their cords are too thin to hold a knife. */
function pendantSolids(): KnifeSolid[] {
  return PENDANT_LAMPS.flatMap(({ x, y, z }) => [
    shade(x, y, z, PENDANT_SHADE),
    ellipsoid(x, y + 0.06, z, 0.055, 0.044, 0.055),
  ]);
}

/** The counters round the walls, and what is built over them: splashes, the pan shelf, the fridge. */
function wallCounterSolids(): KnifeSolid[] {
  const w = KITCHEN.windowCounter;
  const d = KITCHEN.plonge;
  const fr = KITCHEN.fridge;
  const front = fr.minX + 0.45;
  return [
    ...counterSolids(w),
    box(w.minX, w.maxX, TOP, WINDOWS.bottom, -HZ, -HZ + 0.03),
    ...counterSolids(d),
    box(d.minX, d.maxX, TOP, 1.38, HZ - 0.03, HZ),
    box(d.minX, d.maxX, 1.88, 1.92, HZ - 0.42, HZ),
    ...Array.from({ length: 5 }, (_, i) => {
      const x = d.minX + 0.4 + i * 0.65;
      return box(x - 0.22, x + 0.22, 1.92, 2.12, HZ - 0.37, HZ - 0.05);
    }),
    // The fridge: its body, the steel frame round its door, and the glass set back in the frame.
    box(front, fr.maxX, 0, fr.top, fr.minZ, fr.maxZ),
    box(fr.minX, front, 0, 0.2, fr.minZ, fr.maxZ),
    box(fr.minX, front, fr.top - 0.2, fr.top, fr.minZ, fr.maxZ),
    box(fr.minX, front, 0.2, fr.top - 0.2, fr.minZ, fr.minZ + 0.1),
    box(fr.minX, front, 0.2, fr.top - 0.2, fr.maxZ - 0.1, fr.maxZ),
    box(fr.minX + 0.02, front, 0.2, fr.top - 0.2, fr.minZ + 0.1, fr.maxZ - 0.1),
  ];
}

/** The open shelving and the sheet-pan rack: their uprights, shelves, and what stands on them. */
function storageSolids(): KnifeSolid[] {
  const s = KITCHEN.shelving;
  const r = KITCHEN.panRack;
  const solids: KnifeSolid[] = [];
  for (const x of [s.minX + 0.02, s.maxX - 0.02]) {
    for (const z of [s.minZ + 0.02, s.maxZ - 0.02]) {
      solids.push(box(x - 0.015, x + 0.015, 0, s.top, z - 0.015, z + 0.015));
    }
  }
  for (const y of SHELVING_SHELVES) solids.push(box(s.minX, s.maxX, y - 0.02, y, s.minZ, s.maxZ));
  for (const bin of shelvingBins()) {
    solids.push(
      bin.kind === 'tub'
        ? box(s.minX + 0.06, s.maxX - 0.06, bin.y, bin.y + 0.28, bin.z - 0.18, bin.z + 0.18)
        : cylinder(s.minX + 0.22, bin.y, bin.z, 0.07, 0.23),
    );
  }
  for (const x of [r.minX + 0.03, r.maxX - 0.03]) {
    for (const z of [r.minZ + 0.03, r.maxZ - 0.03]) {
      solids.push(box(x - 0.015, x + 0.015, 0, r.top, z - 0.015, z + 0.015));
    }
  }
  for (let i = 0; i < 12; i++) {
    const y = 0.22 + i * 0.13;
    solids.push(box(r.minX + 0.04, r.maxX - 0.04, y, y + 0.012, r.minZ + 0.05, r.maxZ - 0.05));
  }
  return solids;
}

/** The chef's desk, the computer on it (the CRT's bezel, tube, back, neck and foot), and the corkboard. */
function deskSolids(): KnifeSolid[] {
  const d = KITCHEN.desk;
  const top = d.top;
  const front = COMPUTER.x - 0.03;
  const { y, z } = COMPUTER;
  const legs: KnifeSolid[] = [];
  for (const x of [d.minX + 0.05, d.maxX - 0.06]) {
    for (const lz of [d.minZ + 0.06, d.maxZ - 0.06]) {
      legs.push(box(x - 0.02, x + 0.02, 0, top - 0.045, lz - 0.02, lz + 0.02));
    }
  }
  return [
    box(d.minX, d.maxX, top - 0.045, top, d.minZ, d.maxZ),
    ...legs,
    box(d.minX + 0.03, d.maxX - 0.04, 0.16, 0.18, d.minZ + 0.04, d.maxZ - 0.04),
    box(d.minX + 0.08, d.minX + 0.5, 0.18, 0.62, d.maxZ - 0.5, d.maxZ - 0.1),
    box(d.minX + 0.1, d.minX + 0.42, 0.18, 0.28, d.minZ + 0.1, d.minZ + 0.42),
    box(front - 0.07, front, y - 0.19, y + 0.19, z - 0.23, z + 0.23),
    box(front - 0.36, front - 0.07, y - 0.15, y + 0.155, z - 0.17, z + 0.17),
    box(front - 0.42, front - 0.36, y - 0.11, y + 0.11, z - 0.12, z + 0.12),
    box(front - 0.3, front - 0.08, top + 0.025, y - 0.19, z - 0.07, z + 0.07),
    box(front - 0.32, front - 0.04, top, top + 0.025, z - 0.15, z + 0.15),
    box(front + 0.12, front + 0.28, top, top + 0.035, z - 0.22, z + 0.22),
    box(d.minX, d.minX + 0.02, 1.42, 2.02, d.minZ + 0.12, d.maxZ - 0.12),
  ];
}

/**
 * The station centerpieces big enough to stop a knife: the pots and pans, boards and platters, the
 * fish, the chicken, the cloche, the croquembouche and the mixer. Small things (a pepper mill, the
 * eggs, a mug, the garnish) and the five dishes on the pass let a knife through into what they
 * stand on, which reads as stabbing them.
 */
function stationPropSolids(): KnifeSolid[] {
  const zone = TOP + 0.01;
  const onBurner = zone + 0.062;
  const marble = TOP + 0.02;
  const passZ = (KITCHEN.pass.minZ + KITCHEN.pass.maxZ) / 2;
  return [
    // The middle of the piano: the big stockpot and the copper rondeau on their burners, and the
    // salt box, towels and utensil crock at its ends.
    cylinder(-0.55, onBurner, 0, 0.27, 0.46),
    cylinder(0.6, onBurner, 0, 0.3, 0.15),
    boxAt(-4.3, TOP + 0.06, -0.4, 0.18, 0.12, 0.14),
    box(-4.45, -4.15, TOP + 0.002, TOP + 0.088, 0.63, 0.87),
    cylinder(4.3, TOP, 0.3, 0.13, 0.08, 1.4),
    // Saucier: three saucepans and a bain-marie.
    cylinder(-2.96, zone, -0.7, 0.13, 0.12),
    cylinder(-2.55, zone, -0.63, 0.17, 0.15),
    cylinder(-2.15, zone, -0.8, 0.11, 0.1),
    cylinder(-3.35, zone, -0.9, 0.09, 0.16),
    // Poissonnier: the fish on its tray, and the oval kettle with its lid ajar.
    box(2.1, 2.8, zone, zone + 0.02, -0.9, -0.55),
    ellipsoid(2.45, zone + 0.06, -0.72, 0.276, 0.048, 0.084),
    round(
      3.15,
      -0.65,
      [
        [0.32, onBurner],
        [0.32, onBurner + 0.13],
        [0.27, onBurner + 0.155],
      ],
      0.42,
    ),
    // Rôtisseur: the plancha, and the chicken in its roasting pan.
    box(2.95, 3.55, zone, zone + 0.03, 0.35, 1.15),
    box(2.28, 2.82, zone, zone + 0.02, 0.55, 0.95),
    box(2.28, 2.82, zone, zone + 0.08, 0.55, 0.57),
    box(2.28, 2.82, zone, zone + 0.08, 0.93, 0.95),
    box(2.28, 2.3, zone, zone + 0.08, 0.55, 0.95),
    box(2.8, 2.82, zone, zone + 0.08, 0.55, 0.95),
    ellipsoid(2.55, zone + 0.1, 0.75, 0.162, 0.11, 0.126),
    // Entremetier: the stockpot, the cutting board, and the bowl of eggs.
    cylinder(-3.05, onBurner, 0.75, 0.21, 0.36),
    boxAt(-2.35, zone + 0.015, 0.77, 0.5, 0.03, 0.32),
    cylinder(-1.85, zone, 0.65, 0.12, 0.07, 1.3),
    // Le passe: the stack of side towels.
    box(-3.74, -3.46, TOP + 0.002, TOP + 0.11, passZ - 0.11, passZ + 0.11),
    // Garde manger: the cheese board under its cloche, the pâté on its board, the oysters.
    cylinder(3.2, TOP, -4.2, 0.22, 0.03),
    ellipsoid(3.2, TOP + 0.03, -4.2, 0.19, 0.2185, 0.19, true),
    boxAt(2.1, TOP + 0.012, -4.2, 0.5, 0.025, 0.24),
    rounded(2.05, TOP + 0.075, -4.2, 0.28, 0.1, 0.12, 0.015),
    round(4.3, -4.2, [
      [0.26, TOP],
      [0.26, TOP + 0.03],
      [0.24, TOP + 0.04],
    ]),
    // Pâtisserie: the marble slab, the croquembouche on its base, the mixer, the rolling pin.
    box(-4.8, -1.5, TOP, marble, -4.6, -3.8),
    cylinder(-3.2, marble, -4.2, 0.22, 0.02),
    // Its choux, 3.2 cm round, ring a cone; the solid runs through them, short of their outsides.
    round(-3.2, -4.2, [
      [0.18, marble + 0.02],
      [0.192, marble + 0.05],
      [0.032, marble + 0.67],
      [0, marble + 0.69],
    ]),
    rounded(-2.2, marble + 0.03, -4.3, 0.34, 0.06, 0.2, 0.025),
    rounded(-2.08, marble + 0.2, -4.3, 0.11, 0.32, 0.13, 0.04),
    rounded(-2.22, marble + 0.4, -4.3, 0.4, 0.13, 0.15, 0.06),
    cylinder(-2.26, marble + 0.06, -4.3, 0.085, 0.15, 1.25),
    box(-1.68, -1.62, marble, marble + 0.06, -4.28, -3.82),
    // Plonge: the pre-rinse riser, the stacks of clean plates, and the rack of glasses.
    cylinder(7.2, TOP, KITCHEN.plonge.maxZ - 0.1, 0.025, 1.1),
    cylinder(6.05, TOP + 0.02, 6.18, 0.15, 15 * 0.018 + 0.014),
    cylinder(6.4, TOP + 0.02, 6.18, 0.15, 10 * 0.018 + 0.014),
    box(4.85, 5.75, TOP + 0.02, TOP + 0.03, 5.98, 6.36),
  ];
}

/**
 * Everything a thrown knife sticks into besides the floor, the walls and the vault, each drawn tight
 * round what the client shows: the fixtures as built (a counter's overhanging top, an island's open
 * shelves), the hood's skirt and body, the lamps, the gantry, the shelving, the doors and signs, the
 * computer, and the bigger props on the stations.
 */
export const KNIFE_SOLIDS: readonly KnifeSolid[] = [
  ...shellSolids(),
  ...doorSolids(),
  ...pianoSolids(),
  ...hoodSolids(),
  ...passSolids(),
  ...islandSolids(KITCHEN.gardeManger),
  ...islandSolids(KITCHEN.pastryIsland),
  ...pendantSolids(),
  ...wallCounterSolids(),
  ...storageSolids(),
  ...deskSolids(),
  ...stationPropSolids(),
];

/**
 * What hangs in the cold room behind the walk-in, for knives thrown in once it is open, as
 * coolerRoom.ts draws it: its two lamps on the ceiling, and the refrigeration unit high on the back
 * wall (its casing, the frosted fins of the coil under it, the drip tray, and the casing's ends). The
 * room's walls, ceiling and open door are `COOLER_KNIFE_SOLIDS`; its shelving is wire.
 */
export const COOLER_ROOM_KNIFE_SOLIDS: readonly KnifeSolid[] = (() => {
  const { minX, maxX, minZ, maxZ, height } = COOLER;
  const lampZ = (minZ + maxZ) / 2;
  const front = maxX - 0.42;
  const top = height - 0.06;
  const bottom = height - 0.52;
  const coil = bottom + 0.11;
  const [z0, z1] = [-4.9, -3.4];
  return [
    ...[minX + 0.95, maxX - 0.95].map((x) =>
      box(x - 0.09, x + 0.09, height - 0.08, height, lampZ - 0.65, lampZ + 0.65),
    ),
    box(front, maxX, coil, top, z0, z1),
    box(front + 0.005, maxX, bottom, coil, z0, z1),
    box(front - 0.01, maxX, bottom - 0.025, bottom, z0, z1),
    box(front, maxX, bottom, coil, z0, z0 + 0.03),
    box(front, maxX, bottom, coil, z1 - 0.03, z1),
  ];
})();
