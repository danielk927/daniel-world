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
// Shared details of the kitchen as drawn
//
// What has to be drawn and solid the same way and is more than a box (the lamp shades, the
// skylights, the plates stacked on the islands) is defined here and drawn from.
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
 * What a thrown knife can stick into, besides the floor, walls and vault: each fixture at its real
 * height (unlike COLLIDERS, which reach far above counters to stop players jumping onto them), and
 * the hood. Small props on the counters do not stop a knife.
 */
export const KNIFE_SOLIDS: readonly BoxCollider[] = [
  ...Object.values(KITCHEN).map((fixture): BoxCollider => ({
    kind: 'box',
    minX: fixture.minX,
    maxX: fixture.maxX,
    minZ: fixture.minZ,
    maxZ: fixture.maxZ,
    bottom: 'bottom' in fixture ? fixture.bottom : 0,
    top: fixture.top,
  })),
  // The computer's monitor, so a knife thrown at it sticks in the CRT instead of passing through to
  // the wall and poking out of the screen.
  {
    kind: 'box',
    minX: KITCHEN.desk.minX,
    maxX: COMPUTER.x - 0.03,
    minZ: COMPUTER.z - 0.23,
    maxZ: COMPUTER.z + 0.23,
    bottom: KITCHEN.desk.top,
    top: COMPUTER.y + 0.2,
  },
];
