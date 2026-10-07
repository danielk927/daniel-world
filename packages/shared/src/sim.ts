import {
  AIR_ACCEL,
  GRAVITY,
  GROUND_ACCEL,
  JUMP_SPEED,
  Keys,
  MAX_FALL_SPEED,
  MAX_PITCH,
  MAX_Y,
  MIN_Y,
  PLAY_HALF_X,
  PLAY_HALF_Z,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SIM_SUBSTEPS,
  SPRINT_SPEED,
  STEP_HEIGHT,
  TICK_SECONDS,
  WALK_SPEED,
} from './constants.ts';
import { COLLIDERS, PLAY_BOUNDS, SPAWN, type Collider } from './world.ts';

/**
 * Deterministic player movement shared by client prediction and the server.
 * Given the same state and inputs, both sides produce bit-identical results.
 */

export interface PlayerState {
  x: number;
  /** Height of the player's feet. */
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  yaw: number;
  pitch: number;
  grounded: boolean;
}

/** One tick of player intent. */
export interface PlayerInput {
  keys: number;
  yaw: number;
  pitch: number;
}

export function createPlayerState(
  x: number = SPAWN.x,
  z: number = SPAWN.z,
  yaw: number = SPAWN.yaw,
): PlayerState {
  return { x, y: 0, z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0, grounded: true };
}

export function copyPlayerState(from: PlayerState, to: PlayerState): PlayerState {
  to.x = from.x;
  to.y = from.y;
  to.z = from.z;
  to.vx = from.vx;
  to.vy = from.vy;
  to.vz = from.vz;
  to.yaw = from.yaw;
  to.pitch = from.pitch;
  to.grounded = from.grounded;
  return to;
}

/** Snap to a fixed grid so state is compact on the wire and identical after a JSON round trip. */
function quantize(v: number): number {
  // `+ 0` turns -0 into 0, which is what JSON would do anyway.
  return Math.round(v * 10000) / 10000 + 0;
}

const TAU = Math.PI * 2;

export function wrapAngle(a: number): number {
  const wrapped = a - TAU * Math.floor((a + Math.PI) / TAU);
  return wrapped;
}

function overlapsHorizontally(c: Collider, x: number, z: number, radius = PLAYER_RADIUS): boolean {
  if (c.kind === 'cylinder') {
    const dx = x - c.x;
    const dz = z - c.z;
    const reach = c.radius + radius;
    return dx * dx + dz * dz < reach * reach;
  }
  const px = Math.min(Math.max(x, c.minX), c.maxX);
  const pz = Math.min(Math.max(z, c.minZ), c.maxZ);
  const dx = x - px;
  const dz = z - pz;
  return dx * dx + dz * dz < radius * radius;
}

/** Highest walkable surface under the player whose top is at most a step above their feet. */
export function floorHeight(
  x: number,
  z: number,
  feetY: number,
  colliders: readonly Collider[] = COLLIDERS,
): number {
  // The kitchen floor is flat, at y = 0.
  let floor = 0;
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i]!;
    if (c.top > floor && c.top <= feetY + STEP_HEIGHT && overlapsHorizontally(c, x, z)) {
      floor = c.top;
    }
  }
  return floor;
}

/** Whether the player's body overlaps any collider it cannot step onto, at its current height. */
export function isInsideCollider(
  s: PlayerState,
  colliders: readonly Collider[] = COLLIDERS,
): boolean {
  for (let i = 0; i < colliders.length; i++) {
    const c = colliders[i]!;
    if (
      c.top > s.y + STEP_HEIGHT &&
      c.bottom < s.y + PLAYER_HEIGHT &&
      // A millimeter of slack: resting against a counter is not being inside it.
      overlapsHorizontally(c, s.x, s.z, PLAYER_RADIUS - 1e-3)
    ) {
      return true;
    }
  }
  return false;
}

/** Push the player out of a collider sideways and cancel velocity into it. */
function pushOut(s: PlayerState, c: Collider): void {
  let nx: number;
  let nz: number;
  if (c.kind === 'cylinder') {
    let dx = s.x - c.x;
    let dz = s.z - c.z;
    const reach = c.radius + PLAYER_RADIUS;
    const d2 = dx * dx + dz * dz;
    if (d2 >= reach * reach) return;
    let d = Math.sqrt(d2);
    if (d < 1e-9) {
      dx = 1;
      dz = 0;
      d = 1;
    }
    nx = dx / d;
    nz = dz / d;
    s.x = c.x + nx * reach;
    s.z = c.z + nz * reach;
  } else {
    const px = Math.min(Math.max(s.x, c.minX), c.maxX);
    const pz = Math.min(Math.max(s.z, c.minZ), c.maxZ);
    const dx = s.x - px;
    const dz = s.z - pz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= PLAYER_RADIUS * PLAYER_RADIUS) return;
    if (d2 > 1e-12) {
      const d = Math.sqrt(d2);
      nx = dx / d;
      nz = dz / d;
      s.x = px + nx * PLAYER_RADIUS;
      s.z = pz + nz * PLAYER_RADIUS;
    } else {
      // Center is inside the box: leave through the nearest face that opens into the room. A face
      // against a wall does not count, or the wall clamp would put the player straight back inside.
      const toMinX = c.minX - PLAYER_RADIUS >= -PLAY_HALF_X ? s.x - c.minX : Infinity;
      const toMaxX = c.maxX + PLAYER_RADIUS <= PLAY_HALF_X ? c.maxX - s.x : Infinity;
      const toMinZ = c.minZ - PLAYER_RADIUS >= -PLAY_HALF_Z ? s.z - c.minZ : Infinity;
      const toMaxZ = c.maxZ + PLAYER_RADIUS <= PLAY_HALF_Z ? c.maxZ - s.z : Infinity;
      const least = Math.min(toMinX, toMaxX, toMinZ, toMaxZ);
      nx = 0;
      nz = 0;
      if (least === toMinX) {
        nx = -1;
        s.x = c.minX - PLAYER_RADIUS;
      } else if (least === toMaxX) {
        nx = 1;
        s.x = c.maxX + PLAYER_RADIUS;
      } else if (least === toMinZ) {
        nz = -1;
        s.z = c.minZ - PLAYER_RADIUS;
      } else {
        nz = 1;
        s.z = c.maxZ + PLAYER_RADIUS;
      }
    }
  }
  const into = s.vx * nx + s.vz * nz;
  if (into < 0) {
    s.vx -= into * nx;
    s.vz -= into * nz;
  }
}

/** Advance one player by one tick. Mutates `s` in place; allocation free. */
export function stepPlayer(
  s: PlayerState,
  input: PlayerInput,
  colliders: readonly Collider[] = COLLIDERS,
): void {
  const dt = TICK_SECONDS;
  const keys = input.keys;
  s.yaw = Number.isFinite(input.yaw) ? quantize(wrapAngle(input.yaw)) : s.yaw;
  s.pitch = Number.isFinite(input.pitch)
    ? quantize(Math.min(MAX_PITCH, Math.max(-MAX_PITCH, input.pitch)))
    : s.pitch;

  // Desired horizontal direction in world space. Yaw 0 looks down -Z.
  let localX = 0;
  let localZ = 0;
  if (keys & Keys.Forward) localZ -= 1;
  if (keys & Keys.Back) localZ += 1;
  if (keys & Keys.Left) localX -= 1;
  if (keys & Keys.Right) localX += 1;
  const sin = Math.sin(s.yaw);
  const cos = Math.cos(s.yaw);
  let wishX = localX * cos + localZ * sin;
  let wishZ = -localX * sin + localZ * cos;
  const wishLen = Math.sqrt(wishX * wishX + wishZ * wishZ);
  const hasInput = wishLen > 0;
  if (hasInput) {
    const speed = keys & Keys.Sprint ? SPRINT_SPEED : WALK_SPEED;
    wishX = (wishX / wishLen) * speed;
    wishZ = (wishZ / wishLen) * speed;
  }

  // Ease velocity toward the target. In the air, momentum is kept unless the player steers.
  if (s.grounded || hasInput) {
    const accel = s.grounded ? GROUND_ACCEL : AIR_ACCEL;
    let dvx = wishX - s.vx;
    let dvz = wishZ - s.vz;
    const dv = Math.sqrt(dvx * dvx + dvz * dvz);
    const maxDv = accel * dt;
    if (dv > maxDv) {
      dvx = (dvx / dv) * maxDv;
      dvz = (dvz / dv) * maxDv;
    }
    s.vx += dvx;
    s.vz += dvz;
  }

  if (keys & Keys.Jump && s.grounded) {
    s.vy = JUMP_SPEED;
    s.grounded = false;
  }

  const h = dt / SIM_SUBSTEPS;
  for (let i = 0; i < SIM_SUBSTEPS; i++) {
    s.vy = Math.max(s.vy - GRAVITY * h, -MAX_FALL_SPEED);

    // Vertical: bump heads on overhangs such as the hood over the piano.
    const prevFeet = s.y;
    const prevHead = s.y + PLAYER_HEIGHT;
    s.y += s.vy * h;
    if (s.vy > 0) {
      for (let j = 0; j < colliders.length; j++) {
        const c = colliders[j]!;
        if (
          prevHead <= c.bottom + 1e-6 &&
          s.y + PLAYER_HEIGHT > c.bottom &&
          overlapsHorizontally(c, s.x, s.z)
        ) {
          s.y = c.bottom - PLAYER_HEIGHT;
          s.vy = 0;
        }
      }
    }

    // Horizontal: slide along anything that spans the body above step height.
    s.x += s.vx * h;
    s.z += s.vz * h;
    for (let j = 0; j < colliders.length; j++) {
      const c = colliders[j]!;
      if (c.top > s.y + STEP_HEIGHT && c.bottom < s.y + PLAYER_HEIGHT) pushOut(s, c);
    }

    // The walls are colliders like the fixtures; this only guarantees nobody leaves the building.
    if (s.x > PLAY_BOUNDS.maxX || s.x < PLAY_BOUNDS.minX) {
      s.x = s.x > 0 ? PLAY_BOUNDS.maxX : PLAY_BOUNDS.minX;
      if (s.vx * s.x > 0) s.vx = 0;
    }
    if (s.z > PLAY_BOUNDS.maxZ || s.z < PLAY_BOUNDS.minZ) {
      s.z = s.z > 0 ? PLAY_BOUNDS.maxZ : PLAY_BOUNDS.minZ;
      if (s.vz * s.z > 0) s.vz = 0;
    }

    // Ground: land, step up, or stick to gentle downhill slopes.
    // Search from the higher of the old and new feet, so a fast fall cannot skip past a surface.
    const floor = floorHeight(s.x, s.z, Math.max(s.y, prevFeet), colliders);
    if (s.y <= floor) {
      s.y = floor;
      if (s.vy <= 0) {
        s.vy = 0;
        s.grounded = true;
      }
    } else if (s.grounded && s.vy <= 0 && s.y - floor <= STEP_HEIGHT) {
      s.y = floor;
      s.vy = 0;
    } else {
      s.grounded = false;
    }
  }

  // Safety net: nothing should let a player escape, but never let them fall forever.
  if (s.y < MIN_Y || s.y > MAX_Y || !Number.isFinite(s.x + s.y + s.z)) {
    respawn(s);
  }

  s.x = quantize(s.x);
  s.y = quantize(s.y);
  s.z = quantize(s.z);
  s.vx = quantize(s.vx);
  s.vy = quantize(s.vy);
  s.vz = quantize(s.vz);
}

export function respawn(s: PlayerState): void {
  s.x = SPAWN.x;
  s.z = SPAWN.z;
  s.y = 0;
  s.vx = 0;
  s.vy = 0;
  s.vz = 0;
  s.grounded = true;
}
