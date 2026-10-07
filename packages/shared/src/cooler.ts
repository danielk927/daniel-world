import { TICK_RATE } from './constants.ts';
import { COOLER_DOOR } from './world.ts';

/**
 * The walk-in cooler is a secret: its door gives way after enough punches and knives. The server
 * counts the hits and tells everyone where each landed, so every screen dents the same door in the
 * same places; once it bursts, the doorway opens for everyone's movement on inputs the server names
 * (see `coolerColliders` in world.ts).
 */

/** Hits it takes to burst the walk-in's door open. */
export const COOLER_HITS_TO_OPEN = 10;

/** How far a punch reaches, from the eye: an arm's length and a lean. */
export const PUNCH_REACH = 1.3;

/**
 * Once the door bursts, each cook's steps see the doorway open this many inputs after the newest
 * of theirs the server has: about when the swinging door has cleared the doorway, and long enough
 * that the message arrives before their prediction gets there, so nobody is ever corrected.
 */
export const COOLER_OPEN_DELAY_INPUTS = Math.round(0.4 * TICK_RATE);

export type CoolerHitKind = 'fist' | 'knife';

/** Where a hit landed on the door's face: `z` along the wall, `y` up. */
export interface CoolerDent {
  readonly z: number;
  readonly y: number;
  readonly by: CoolerHitKind;
}

/** Whether the walk-in's door has burst open, after these hits. */
export function coolerBurst(hits: number): boolean {
  return hits >= COOLER_HITS_TO_OPEN;
}

/** Keep hits this far inside the door's edges, so every dent sits on the door. */
const EDGE = 0.04;

/** Snap to a millimeter, so a dent is the same on every screen after a JSON round trip. */
function millimeters(v: number): number {
  return Math.round(v * 1000) / 1000 + 0;
}

/** Whether (y, z) is on the shut door's face, inside its edges. */
function onDoor(y: number, z: number): boolean {
  return (
    z >= COOLER_DOOR.from + EDGE &&
    z <= COOLER_DOOR.to - EDGE &&
    y >= COOLER_DOOR.bottom + EDGE &&
    y <= COOLER_DOOR.top - EDGE
  );
}

/**
 * Where a punch thrown from an eye at (x, y, z), looking along `yaw` and `pitch`, lands on the shut
 * door's face, or null if the door is not in front of the fist within reach.
 */
export function punchOnCoolerDoor(
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
): { z: number; y: number } | null {
  const level = Math.cos(pitch);
  const dx = -Math.sin(yaw) * level;
  if (dx <= 1e-6) return null;
  const distance = (COOLER_DOOR.face - x) / dx;
  if (distance < 0 || distance > PUNCH_REACH) return null;
  const hitY = y + Math.sin(pitch) * distance;
  const hitZ = z - Math.cos(yaw) * level * distance;
  return onDoor(hitY, hitZ) ? { z: millimeters(hitZ), y: millimeters(hitY) } : null;
}

/** Where a knife stuck with its tip at (x, y, z) is in the shut door, or null if it is not. */
export function knifeInCoolerDoor(
  x: number,
  y: number,
  z: number,
): { z: number; y: number } | null {
  const inside = x >= COOLER_DOOR.face - 1e-3 && x <= COOLER_DOOR.face + COOLER_DOOR.thickness;
  return inside && onDoor(y, z) ? { z: millimeters(z), y: millimeters(y) } : null;
}
