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
  PLAY_RADIUS,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SIM_SUBSTEPS,
  SPRINT_SPEED,
  STEP_HEIGHT,
  TICK_SECONDS,
  WALK_SPEED,
} from './constants.ts';
import { COLLIDERS, SPAWN, terrainHeight, type Collider } from './world.ts';

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
  return { x, y: terrainHeight(x, z), z, vx: 0, vy: 0, vz: 0, yaw, pitch: 0, grounded: true };
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
  return Math.round(v * 10000) / 10000;
}

const TAU = Math.PI * 2;

export function wrapAngle(a: number): number {
  const wrapped = a - TAU * Math.floor((a + Math.PI) / TAU);
  return wrapped;
}

function overlapsHorizontally(c: Collider, x: number, z: number): boolean {
  if (c.kind === 'cylinder') {
    const dx = x - c.x;
    const dz = z - c.z;
    const reach = c.radius + PLAYER_RADIUS;
    return dx * dx + dz * dz < reach * reach;
  }
  const px = Math.min(Math.max(x, c.minX), c.maxX);
  const pz = Math.min(Math.max(z, c.minZ), c.maxZ);
  const dx = x - px;
  const dz = z - pz;
  return dx * dx + dz * dz < PLAYER_RADIUS * PLAYER_RADIUS;
}

/** Highest walkable surface under the player whose top is at most a step above their feet. */
export function floorHeight(
  x: number,
  z: number,
  feetY: number,
  colliders: readonly Collider[] = COLLIDERS,
): number {
  let floor = terrainHeight(x, z);
  for (const c of colliders) {
    if (c.top > floor && c.top <= feetY + STEP_HEIGHT && overlapsHorizontally(c, x, z)) {
      floor = c.top;
    }
  }
  return floor;
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
      // Center is inside the box: leave through the nearest face.
      const toMinX = s.x - c.minX;
      const toMaxX = c.maxX - s.x;
      const toMinZ = s.z - c.minZ;
      const toMaxZ = c.maxZ - s.z;
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
  s.yaw = quantize(wrapAngle(input.yaw));
  s.pitch = quantize(Math.min(MAX_PITCH, Math.max(-MAX_PITCH, input.pitch)));

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

    // Vertical: bump heads on overhangs such as the arch lintel.
    const prevHead = s.y + PLAYER_HEIGHT;
    s.y += s.vy * h;
    if (s.vy > 0) {
      for (const c of colliders) {
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
    for (const c of colliders) {
      if (c.top > s.y + STEP_HEIGHT && c.bottom < s.y + PLAYER_HEIGHT) pushOut(s, c);
    }

    // Keep inside the rim wall.
    const r2 = s.x * s.x + s.z * s.z;
    if (r2 > PLAY_RADIUS * PLAY_RADIUS) {
      const r = Math.sqrt(r2);
      const nx = s.x / r;
      const nz = s.z / r;
      s.x = nx * PLAY_RADIUS;
      s.z = nz * PLAY_RADIUS;
      const out = s.vx * nx + s.vz * nz;
      if (out > 0) {
        s.vx -= out * nx;
        s.vz -= out * nz;
      }
    }

    // Ground: land, step up, or stick to gentle downhill slopes.
    const floor = floorHeight(s.x, s.z, s.y, colliders);
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
  s.y = terrainHeight(SPAWN.x, SPAWN.z);
  s.vx = 0;
  s.vy = 0;
  s.vz = 0;
  s.grounded = true;
}
