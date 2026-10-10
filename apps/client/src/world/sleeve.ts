import { LatheGeometry, Vector2, type BufferGeometry } from 'three';

/**
 * The sleeve and cuff of the arm on screen: a chef's jacket sleeve, loose at the wrist, falling in
 * soft folds and rolled under at its hem, and the shirt cuff showing inside it. Both lie along Z,
 * centered on the origin, the wrist toward -Z; their texture coordinates are meters (round the
 * sleeve and along it), for the kitchen's cloth (surfaces/recipes.ts).
 */

/** Sides round the sleeve and cuff: their outline stays round however close they come. */
const SIDES = 48;
/**
 * How much finer a chef's jacket is woven than the kitchen's cloth (towels, aprons): at arm's length
 * its threads are a texture, not bumps.
 */
const COTTON = 2.5;

const SLEEVE_LENGTH = 0.36;
/** The sleeve's radius at the elbow, out of view, and at the wrist, where it hangs loose. */
const ELBOW_RADIUS = 0.036;
const WRIST_RADIUS = 0.05;
/** Where its hem rolls under, toward the cuff inside it. */
const HEM = 0.007;

/**
 * A lathe of `profile` (radius, then position along the length, from +Z to -Z) turned about Z, its
 * texture coordinates in meters, and `fold` moving each point out (or in) by how far round and
 * along it is.
 */
function turned(
  profile: readonly (readonly [number, number])[],
  fold: (angle: number, z: number, radius: number) => number,
): BufferGeometry {
  // A lathe faces out when its profile climbs.
  const geometry = new LatheGeometry(profile.map(([r, z]) => new Vector2(r, z)).reverse(), SIDES);
  // Lathe turns about Y; the arm runs along Z.
  geometry.rotateX(Math.PI / 2);
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const radius = Math.hypot(x, y);
    const angle = Math.atan2(y, x);
    const out = radius > 1e-6 ? fold(angle, z, radius) : 0;
    if (radius > 1e-6) position.setXYZ(i, x * (1 + out / radius), y * (1 + out / radius), z);
    // Meters round the middle of the sleeve and along it, as many of them as the jacket's cotton
    // is woven finer than the kitchen's linen.
    uv.setXY(i, uv.getX(i) * Math.PI * 2 * 0.043 * COTTON, z * COTTON);
  }
  geometry.computeVertexNormals();
  // The lathe's seam is two columns of points in one place: give both the same normal.
  const normal = geometry.getAttribute('normal');
  const rows = profile.length;
  for (let j = 0; j < rows; j++) {
    const a = j;
    const b = SIDES * rows + j;
    const nx = normal.getX(a) + normal.getX(b);
    const ny = normal.getY(a) + normal.getY(b);
    const nz = normal.getZ(a) + normal.getZ(b);
    const length = Math.hypot(nx, ny, nz) || 1;
    normal.setXYZ(a, nx / length, ny / length, nz / length);
    normal.setXYZ(b, nx / length, ny / length, nz / length);
  }
  return geometry;
}

/**
 * The sleeve: tapering from the wrist to the elbow, closed at the elbow, its hem rolled under at
 * the wrist. Its folds deepen toward the wrist, where the cloth gathers: a few long ones down its
 * length and a soft ripple round it.
 */
export function sleeveGeometry(): BufferGeometry {
  const half = SLEEVE_LENGTH / 2;
  const profile: [number, number][] = [[0, half]];
  // Along the sleeve from the elbow to just short of the hem.
  for (let k = 0; k <= 16; k++) {
    const t = k / 16;
    const z = half - t * (SLEEVE_LENGTH - HEM);
    profile.push([ELBOW_RADIUS + (WRIST_RADIUS - ELBOW_RADIUS) * t, z]);
  }
  // The hem, rolled under round a quarter circle and tucked in toward the cuff.
  for (let k = 1; k <= 6; k++) {
    const a = (k / 6) * Math.PI * 0.5;
    profile.push([WRIST_RADIUS - HEM * (1 - Math.cos(a)), -half + HEM - HEM * Math.sin(a)]);
  }
  profile.push([WRIST_RADIUS - HEM - 0.002, -half + 0.001], [0.03, -half + 0.004]);
  return turned(profile, (angle, z, radius) => {
    if (radius < ELBOW_RADIUS * 0.5) return 0;
    // 0 at the elbow, 1 at the wrist.
    const toWrist = Math.min(1, Math.max(0, (half - z) / SLEEVE_LENGTH));
    const long = Math.cos(angle * 3 + z * 9 + 0.6) * 0.6 + Math.cos(angle * 5 - z * 14 + 2.1) * 0.4;
    const round = Math.sin(z * 70 + Math.cos(angle * 2) * 1.5) * toWrist * toWrist;
    return (0.0009 + 0.0019 * toWrist) * long + 0.0011 * round;
  });
}

/** The shirt cuff inside the sleeve's hem: a band of cloth with softly rounded edges. */
export function cuffGeometry(): BufferGeometry {
  const outer = 0.041;
  const inner = 0.036;
  const half = 0.0175;
  const edge = 0.0022;
  // Up the inside, then round the edge at each end: out over the top, down the outside, in under
  // the bottom.
  const profile: [number, number][] = [
    [inner, -half],
    [inner, half],
  ];
  for (let k = 0; k <= 4; k++) {
    const a = (k / 4) * Math.PI * 0.5;
    profile.push([outer - edge + edge * Math.sin(a), half - edge + edge * Math.cos(a)]);
  }
  for (let k = 0; k <= 4; k++) {
    const a = (k / 4) * Math.PI * 0.5;
    profile.push([outer - edge + edge * Math.cos(a), -half + edge - edge * Math.sin(a)]);
  }
  profile.push([inner, -half]);
  return turned(profile, () => 0);
}
