import {
  KNIFE_EMBED,
  KNIFE_GRAVITY,
  KNIFE_HIT_HEIGHT,
  KNIFE_HIT_RADIUS,
  KNIFE_SPEED,
  ROOM_HALF_X,
  ROOM_HALF_Z,
  ROOM_HEIGHT,
} from './constants.ts';
import {
  COOLER_KNIFE_SOLIDS,
  KNIFE_SOLIDS,
  inCoolerDoorway,
  vaultHeight,
  type BoxCollider,
} from './world.ts';

/**
 * Thrown knives: a deterministic flight that the server runs to decide hits, and that clients
 * replay from the throw so every screen shows the same arc. Each step is tested as a straight
 * segment against the room, the fixtures and the players, so a fast knife cannot tunnel.
 */

/** A knife in flight. Mutated in place by `flyKnife`. */
export interface KnifeState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Seconds since it left the hand. */
  t: number;
}

/** A player a knife can hit, by the position of their feet. */
export interface KnifeTarget {
  readonly id: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export type KnifeImpact =
  | {
      readonly kind: 'surface';
      /** Where the tip ends up, sunk a little into the surface. */
      readonly x: number;
      readonly y: number;
      readonly z: number;
      /** Unit direction the blade points, tip first: the flight direction at impact. */
      readonly dx: number;
      readonly dy: number;
      readonly dz: number;
      /** Seconds into the flight. */
      readonly t: number;
    }
  | {
      readonly kind: 'player';
      readonly id: number;
      /** Where the knife met the player's body. */
      readonly x: number;
      readonly y: number;
      readonly z: number;
      readonly t: number;
    };

/** Flight steps are this short, so the arc is followed closely between ticks. */
const SUBSTEP = 1 / 80;
/** Bisection steps to find where a segment crosses the curved vault. */
const VAULT_ITERATIONS = 12;

/** A knife leaving an eye at (x, y, z), thrown where the eye looks. Yaw 0 looks toward -Z. */
export function launchKnife(
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
): KnifeState {
  const level = Math.cos(pitch) * KNIFE_SPEED;
  return {
    x,
    y,
    z,
    vx: -Math.sin(yaw) * level,
    vy: Math.sin(pitch) * KNIFE_SPEED,
    vz: -Math.cos(yaw) * level,
    t: 0,
  };
}

/**
 * Fly a knife for `dt` seconds. Returns what it hit first, if anything, and leaves the knife where
 * it stopped. `thrower` is never hit by their own knife. With `coolerOpen`, the walk-in's doorway
 * lets knives through into the cold room.
 */
export function flyKnife(
  knife: KnifeState,
  dt: number,
  targets: readonly KnifeTarget[],
  thrower: number,
  coolerOpen = false,
): KnifeImpact | null {
  let remaining = dt;
  while (remaining > 1e-9) {
    const h = Math.min(SUBSTEP, remaining);
    remaining -= h;
    const vy = knife.vy - KNIFE_GRAVITY * h;
    const dx = knife.vx * h;
    const dy = ((knife.vy + vy) / 2) * h;
    const dz = knife.vz * h;
    const hit = firstHit(knife.x, knife.y, knife.z, dx, dy, dz, targets, thrower, coolerOpen);
    if (hit) {
      const f = hit.f;
      const x = knife.x + dx * f;
      const y = knife.y + dy * f;
      const z = knife.z + dz * f;
      const t = knife.t + h * f;
      knife.x = x;
      knife.y = y;
      knife.z = z;
      knife.vy = knife.vy - KNIFE_GRAVITY * h * f;
      knife.t = t;
      if (hit.player !== null) return { kind: 'player', id: hit.player, x, y, z, t };
      const speed = Math.hypot(knife.vx, knife.vy, knife.vz);
      const ux = knife.vx / speed;
      const uy = knife.vy / speed;
      const uz = knife.vz / speed;
      return {
        kind: 'surface',
        x: x + ux * KNIFE_EMBED,
        y: y + uy * KNIFE_EMBED,
        z: z + uz * KNIFE_EMBED,
        dx: ux,
        dy: uy,
        dz: uz,
        t,
      };
    }
    knife.x += dx;
    knife.y += dy;
    knife.z += dz;
    knife.vy = vy;
    knife.t += h;
  }
  return null;
}

/** Scratch state for `firstHit`, reused so flights never allocate (clients replay them each frame). */
const result = { f: 0, player: null as number | null };
let best = Infinity;
let bestPlayer: number | null = null;

function consider(f: number, id: number | null): void {
  if (f >= 0 && f <= 1 && f < best) {
    best = f;
    bestPlayer = id;
  }
}

/** The earliest thing along the segment from (x, y, z) by (dx, dy, dz), as a fraction of it. */
function firstHit(
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
  targets: readonly KnifeTarget[],
  thrower: number,
  coolerOpen: boolean,
): { f: number; player: number | null } | null {
  best = Infinity;
  bestPlayer = null;
  const ex = x + dx;
  const ey = y + dy;
  const ez = z + dz;
  // The room's shell: floor, walls, and the vault overhead.
  if (ey < 0 && y >= 0) consider(y / (y - ey), null);
  if (ex > ROOM_HALF_X) {
    const f = (ROOM_HALF_X - x) / dx;
    // Into the walk-in's open doorway, the knife flies on into the cold room.
    if (!coolerOpen || !inCoolerDoorway(y + dy * f, z + dz * f)) consider(f, null);
  }
  if (ex < -ROOM_HALF_X) consider((-ROOM_HALF_X - x) / dx, null);
  if (ez > ROOM_HALF_Z) consider((ROOM_HALF_Z - z) / dz, null);
  if (ez < -ROOM_HALF_Z) consider((-ROOM_HALF_Z - z) / dz, null);
  if (ey > ROOM_HEIGHT && aboveVault(ey, ez)) consider(vaultCrossing(y, z, dy, dz), null);
  for (const solid of KNIFE_SOLIDS) consider(segmentBox(x, y, z, dx, dy, dz, solid), null);
  if (coolerOpen) {
    for (const solid of COOLER_KNIFE_SOLIDS) consider(segmentBox(x, y, z, dx, dy, dz, solid), null);
  }
  for (const target of targets) {
    if (target.id !== thrower) consider(segmentBody(x, y, z, dx, dy, dz, target), target.id);
  }
  if (best === Infinity) return null;
  result.f = best;
  result.player = bestPlayer;
  return result;
}

function aboveVault(y: number, z: number): boolean {
  return y > vaultHeight(Math.max(-ROOM_HALF_Z, Math.min(ROOM_HALF_Z, z)));
}

/** Where a segment that starts under the vault and ends above it crosses it, by bisection. */
function vaultCrossing(y: number, z: number, dy: number, dz: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < VAULT_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (aboveVault(y + dy * mid, z + dz * mid)) hi = mid;
    else lo = mid;
  }
  return hi;
}

/** The segment's entry and exit, as fractions of it, narrowed one axis at a time. */
let enter = 0;
let exit = 1;

/** Narrow [enter, exit] to where p + f * d lies within [min, max]. False if it never does. */
function clipAxis(p: number, d: number, min: number, max: number): boolean {
  if (Math.abs(d) < 1e-12) return p >= min && p <= max;
  let a = (min - p) / d;
  let b = (max - p) / d;
  if (a > b) {
    const swap = a;
    a = b;
    b = swap;
  }
  if (a > enter) enter = a;
  if (b < exit) exit = b;
  return enter <= exit;
}

/** Where a segment enters a box, as a fraction of it; Infinity if it misses or starts inside. */
function segmentBox(
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
  box: BoxCollider,
): number {
  const inside =
    x >= box.minX &&
    x <= box.maxX &&
    y >= box.bottom &&
    y <= box.top &&
    z >= box.minZ &&
    z <= box.maxZ;
  if (inside) return Infinity;
  enter = 0;
  exit = 1;
  if (!clipAxis(x, dx, box.minX, box.maxX)) return Infinity;
  if (!clipAxis(y, dy, box.bottom, box.top)) return Infinity;
  if (!clipAxis(z, dz, box.minZ, box.maxZ)) return Infinity;
  return enter;
}

/** Where a segment enters a player's body (an upright cylinder on their feet); else Infinity. */
function segmentBody(
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
  target: KnifeTarget,
): number {
  enter = 0;
  exit = 1;
  // Across the floor: the part of the segment within the body's radius.
  const ox = x - target.x;
  const oz = z - target.z;
  const a = dx * dx + dz * dz;
  const b = 2 * (ox * dx + oz * dz);
  const c = ox * ox + oz * oz - KNIFE_HIT_RADIUS * KNIFE_HIT_RADIUS;
  if (a < 1e-12) {
    if (c > 0) return Infinity;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return Infinity;
    const root = Math.sqrt(disc);
    enter = Math.max(enter, (-b - root) / (2 * a));
    exit = Math.min(exit, (-b + root) / (2 * a));
    if (enter > exit) return Infinity;
  }
  // Up and down: the part within the body's height.
  if (!clipAxis(y, dy, target.y, target.y + KNIFE_HIT_HEIGHT)) return Infinity;
  return enter;
}
