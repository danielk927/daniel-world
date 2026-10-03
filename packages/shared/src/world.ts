import { ROOM_HALF_X, ROOM_HALF_Z } from './constants.ts';

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
} as const satisfies Record<string, Fixture | (Fixture & { bottom: number })>;

export type Wall = 'north' | 'south' | 'east' | 'west';

/**
 * Doors are painted onto the walls; nobody walks through them. Spans run along the wall: x for the
 * north and south walls, z for the east and west walls.
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

export const COLLIDERS: readonly Collider[] = buildColliders();
