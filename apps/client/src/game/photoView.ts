/**
 * A fixed camera for judging the look: `?view=x,y,z,yaw,pitch` (meters and radians, yaw 0 looking
 * north, as the player's look) holds the camera there behind the landing instead of its walk round
 * the kitchen. `scripts/viewpoints.ts` shoots the same frames before and after a visual change with
 * it. Dev and test builds only; the game ignores it in production.
 */
export interface PhotoView {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly yaw: number;
  readonly pitch: number;
}

/**
 * How many cooks to stand in the view, facing it (`?cooks=4`), so their look can be judged from the
 * front: a room's real cooks walk where they like. At most 8.
 */
export function photoCooks(search: string): number {
  const count = Number(new URLSearchParams(search).get('cooks'));
  return Number.isInteger(count) ? Math.max(0, Math.min(8, count)) : 0;
}

/** The view a page address asks for, or null if it asks for none or gives it badly. */
export function photoView(search: string): PhotoView | null {
  const raw = new URLSearchParams(search).get('view');
  if (!raw) return null;
  const parts = raw.split(',').map(Number);
  if (parts.length !== 5 || !parts.every(Number.isFinite)) return null;
  const [x, y, z, yaw, pitch] = parts as [number, number, number, number, number];
  return { x, y, z, yaw, pitch };
}
