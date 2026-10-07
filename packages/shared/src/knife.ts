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
  COOLER_ROOM_KNIFE_SOLIDS,
  KNIFE_SOLIDS,
  SKYLIGHTS,
  SKYLIGHT_WELLS,
  VAULT_EDGES,
  WINDOWS,
  WINDOW_GLASS_DEPTH,
  inCoolerDoorway,
  type BoxCollider,
  type Ring,
  type RoundSolid,
} from './world.ts';

/**
 * Thrown knives: a deterministic flight that the server runs to decide hits, and that clients
 * replay from the throw so every screen shows the same arc. Each step is tested as a straight
 * segment against the room, the solids in it (`KNIFE_SOLIDS`) and the players, so a fast knife
 * cannot tunnel. Nothing here allocates: clients replay every flight each frame.
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
/** A knife's tip stops this short of the far side of something thin, like a shelf or a shade. */
const EMBED_CLEARANCE = 0.005;

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
 * it stopped: where it met the surface, short of where its tip sinks in. `thrower` is never hit by
 * their own knife. With `coolerOpen`, the walk-in's doorway lets knives through into the cold room.
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
      const embed = embedDepth(hit.depth);
      return {
        kind: 'surface',
        x: x + ux * embed,
        y: y + uy * embed,
        z: z + uz * embed,
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

/**
 * How deep a knife sinks into what it hit, given how much of it lies ahead along the blade: the
 * full `KNIFE_EMBED` into a wall or a counter, but never out through the far side of a thin shelf or
 * a lamp shade's wall.
 */
function embedDepth(depth: number): number {
  return Math.min(KNIFE_EMBED, Math.max(depth / 2, depth - EMBED_CLEARANCE));
}

/** Scratch state for `firstHit`, reused so flights never allocate (clients replay them each frame). */
const result = { f: 0, player: null as number | null, depth: Infinity };
let best = Infinity;
let bestPlayer: number | null = null;
let bestDepth = Infinity;

/**
 * Keep a hit `f` along the segment if it is the first so far. `depth` is how much of what was hit
 * lies ahead along the segment, in meters; of two surfaces met at once, the thicker one counts.
 */
function consider(f: number, id: number | null, depth: number): void {
  if (!(f >= 0 && f <= 1)) return;
  if (f < best || (f === best && id === null && bestPlayer === null && depth > bestDepth)) {
    best = f;
    bestPlayer = id;
    bestDepth = depth;
  }
}

/**
 * The floor plan in square cells, each listing the solids over it, so a knife only tests the few
 * near it: `CELL_SOLIDS[CELL_START[c]]` up to `CELL_SOLIDS[CELL_START[c + 1]]` are over cell c. A
 * solid over several cells is tested once a segment, marked with that segment's `stamp`.
 */
const CELL = 1;
const GRID_X = Math.ceil((2 * ROOM_HALF_X) / CELL);
const GRID_Z = Math.ceil((2 * ROOM_HALF_Z) / CELL);
const cellX = (x: number): number =>
  Math.min(GRID_X - 1, Math.max(0, Math.floor((x + ROOM_HALF_X) / CELL)));
const cellZ = (z: number): number =>
  Math.min(GRID_Z - 1, Math.max(0, Math.floor((z + ROOM_HALF_Z) / CELL)));
const { CELL_START, CELL_SOLIDS } = (() => {
  const cells: number[][] = Array.from({ length: GRID_X * GRID_Z }, () => []);
  KNIFE_SOLIDS.forEach((solid, i) => {
    for (let cz = cellZ(solid.minZ); cz <= cellZ(solid.maxZ); cz++) {
      for (let cx = cellX(solid.minX); cx <= cellX(solid.maxX); cx++)
        cells[cz * GRID_X + cx]!.push(i);
    }
  });
  const start = new Int32Array(cells.length + 1);
  cells.forEach((cell, c) => (start[c + 1] = start[c]! + cell.length));
  return { CELL_START: start, CELL_SOLIDS: Int32Array.from(cells.flat()) };
})();
const STAMPS = new Float64Array(KNIFE_SOLIDS.length);
let stamp = 0;

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
): { f: number; player: number | null; depth: number } | null {
  best = Infinity;
  bestPlayer = null;
  bestDepth = Infinity;
  const ex = x + dx;
  const ey = y + dy;
  const ez = z + dz;
  // The room's shell: floor, walls (the north one with its windows), and the vault overhead.
  if (ey < 0 && y >= 0) consider(y / (y - ey), null, Infinity);
  if (ex > ROOM_HALF_X) {
    const f = (ROOM_HALF_X - x) / dx;
    // Into the walk-in's open doorway, the knife flies on into the cold room.
    if (!coolerOpen || !inCoolerDoorway(y + dy * f, z + dz * f)) consider(f, null, Infinity);
  }
  if (ex < -ROOM_HALF_X) consider((-ROOM_HALF_X - x) / dx, null, Infinity);
  if (ez > ROOM_HALF_Z) consider((ROOM_HALF_Z - z) / dz, null, Infinity);
  if (ez < -ROOM_HALF_Z) consider(northWall(x, y, z, dx, dy, dz), null, Infinity);
  if (y > ROOM_HEIGHT || ey > ROOM_HEIGHT) consider(vault(x, y, z, dx, dy, dz), null, Infinity);
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  consider(glazingBars(x, y, z, dx, dy, dz), null, barThrough * length);
  // The solids over the floor cells the segment crosses, passing over any its bounds cannot reach.
  const minX = Math.min(x, ex);
  const maxX = Math.max(x, ex);
  const minY = Math.min(y, ey);
  const maxY = Math.max(y, ey);
  const minZ = Math.min(z, ez);
  const maxZ = Math.max(z, ez);
  stamp++;
  const toX = cellX(maxX);
  const toZ = cellZ(maxZ);
  for (let cz = cellZ(minZ); cz <= toZ; cz++) {
    for (let cx = cellX(minX); cx <= toX; cx++) {
      const cell = cz * GRID_X + cx;
      for (let k = CELL_START[cell]!; k < CELL_START[cell + 1]!; k++) {
        const i = CELL_SOLIDS[k]!;
        if (STAMPS[i] === stamp) continue;
        STAMPS[i] = stamp;
        const solid = KNIFE_SOLIDS[i]!;
        if (solid.minX > maxX || solid.maxX < minX) continue;
        if (solid.bottom > maxY || solid.top < minY) continue;
        if (solid.minZ > maxZ || solid.maxZ < minZ) continue;
        const f =
          solid.kind === 'box'
            ? segmentBox(x, y, z, dx, dy, dz, solid)
            : segmentRound(x, y, z, dx, dy, dz, solid);
        consider(f, null, through * length);
      }
    }
  }
  // The walk-in's walls, ceiling and open door, once it is open, beyond the kitchen's floor plan.
  if (coolerOpen) {
    for (let i = 0; i < COOLER_KNIFE_SOLIDS.length; i++) {
      consider(segmentBox(x, y, z, dx, dy, dz, COOLER_KNIFE_SOLIDS[i]!), null, through * length);
    }
    for (let i = 0; i < COOLER_ROOM_KNIFE_SOLIDS.length; i++) {
      const solid = COOLER_ROOM_KNIFE_SOLIDS[i]!;
      const f =
        solid.kind === 'box'
          ? segmentBox(x, y, z, dx, dy, dz, solid)
          : segmentRound(x, y, z, dx, dy, dz, solid);
      consider(f, null, through * length);
    }
  }
  for (const target of targets) {
    if (target.id !== thrower) {
      consider(segmentBody(x, y, z, dx, dy, dz, target), target.id, Infinity);
    }
  }
  if (best === Infinity) return null;
  result.f = best;
  result.player = bestPlayer;
  result.depth = bestDepth;
  return result;
}

/**
 * Where a segment that ends past the north wall meets it. Over the window strip a knife flies on
 * into the opening and sticks in the glass, or in the opening's side, sill or head if it meets one
 * of them first. Infinity if it reaches nothing.
 */
function northWall(x: number, y: number, z: number, dx: number, dy: number, dz: number): number {
  if (z >= -ROOM_HALF_Z) {
    const f = (-ROOM_HALF_Z - z) / dz;
    const wx = x + dx * f;
    const wy = y + dy * f;
    if (wx < WINDOWS.from || wx > WINDOWS.to || wy < WINDOWS.bottom || wy > WINDOWS.top) return f;
  }
  let out = Infinity;
  if (dz < 0) out = (-ROOM_HALF_Z - WINDOW_GLASS_DEPTH - z) / dz;
  if (dx > 0) out = Math.min(out, (WINDOWS.to - x) / dx);
  else if (dx < 0) out = Math.min(out, (WINDOWS.from - x) / dx);
  if (dy > 0) out = Math.min(out, (WINDOWS.top - y) / dy);
  else if (dy < 0) out = Math.min(out, (WINDOWS.bottom - y) / dy);
  return out;
}

/**
 * The vault's facets as planes, y = y0 + slope * (z - z0). The vault is an arch, so the room under
 * it is the space under every one of them, and a knife leaves it through the first it rises through.
 */
const FACETS = VAULT_EDGES.slice(1).map((b, i) => {
  const a = VAULT_EDGES[i]!;
  return { z: a.z, y: a.y, slope: (b.y - a.y) / (b.z - a.z) };
});

/**
 * Each skylight's well in the frame its walls are built in: from its north edge, `u` along the
 * facet it opens in and `v` out of the vault, found from a point's offset in z and y by this
 * inverse.
 */
const WELLS = SKYLIGHT_WELLS.map(({ a, b, out }, i) => {
  const span = Math.sqrt((b.z - a.z) * (b.z - a.z) + (b.y - a.y) * (b.y - a.y));
  const alongZ = (b.z - a.z) / span;
  const alongY = (b.y - a.y) / span;
  const det = alongZ * out.y - out.z * alongY;
  return {
    facet: SKYLIGHTS.facets[i]!,
    z: a.z,
    y: a.y,
    span,
    uz: out.y / det,
    uy: -out.z / det,
    vz: -alongY / det,
    vy: alongZ / det,
  };
});
type Well = (typeof WELLS)[number];
const PANE = (SKYLIGHTS.halfLength * 2) / SKYLIGHTS.panes;
/** Nothing of the skylights is lower than the lowest edge of their openings. */
const WELLS_BOTTOM = Math.min(...SKYLIGHT_WELLS.map(({ a, b }) => Math.min(a.y, b.y)));

/** Where a segment leaves the room through the vault, or up a skylight; Infinity if it does not. */
function vault(x: number, y: number, z: number, dx: number, dy: number, dz: number): number {
  // Already up a skylight's well: it can only leave by the glass or the well's walls.
  for (const well of WELLS) {
    const rz = z - well.z;
    const ry = y - well.y;
    const u = rz * well.uz + ry * well.uy;
    const v = rz * well.vz + ry * well.vy;
    if (v > 0 && Math.abs(x) <= SKYLIGHTS.halfLength && u >= 0 && u <= well.span) {
      return wellExit(well, x, y, z, dx, dy, dz);
    }
  }
  let first = Infinity;
  let facet = -1;
  for (let i = 0; i < FACETS.length; i++) {
    const plane = FACETS[i]!;
    const rise = dy - plane.slope * dz;
    if (rise <= 0) continue;
    const f = Math.max(0, (plane.y + plane.slope * (z - plane.z) - y) / rise);
    if (f < first) {
      first = f;
      facet = i;
    }
  }
  if (first > 1) return Infinity;
  // Through a skylight's opening: on up its well.
  for (const well of WELLS) {
    if (well.facet !== facet) continue;
    const u = (z + dz * first - well.z) * well.uz + (y + dy * first - well.y) * well.uy;
    if (Math.abs(x + dx * first) <= SKYLIGHTS.halfLength && u >= 0 && u <= well.span) {
      return wellExit(well, x, y, z, dx, dy, dz);
    }
  }
  return first;
}

/**
 * Where a line in a skylight's well (or coming up into it through its opening) meets the glass or
 * the well's walls; Infinity if it drops back out through the opening first.
 */
function wellExit(
  well: Well,
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
): number {
  const rz = z - well.z;
  const ry = y - well.y;
  const u = rz * well.uz + ry * well.uy;
  const du = dz * well.uz + dy * well.uy;
  const v = rz * well.vz + ry * well.vy;
  const dv = dz * well.vz + dy * well.vy;
  // Back down through the opening, into the room again.
  if (dv <= 0) return Infinity;
  const h = SKYLIGHTS.halfLength;
  let out = (SKYLIGHTS.glass - v) / dv;
  if (dx > 0) out = Math.min(out, (h - x) / dx);
  else if (dx < 0) out = Math.min(out, (-h - x) / dx);
  if (du > 0) out = Math.min(out, (well.span - u) / du);
  else if (du < 0) out = Math.min(out, -u / du);
  return out;
}

/**
 * Where a segment meets a skylight's glazing bars, as a fraction of it; Infinity if it does not.
 * Each bar is a box in its well's frame, just under the glass.
 */
function glazingBars(x: number, y: number, z: number, dx: number, dy: number, dz: number): number {
  if (y < WELLS_BOTTOM && y + dy < WELLS_BOTTOM) return Infinity;
  const half = SKYLIGHTS.bar / 2;
  let first = Infinity;
  for (const well of WELLS) {
    const rz = z - well.z;
    const ry = y - well.y;
    const u = rz * well.uz + ry * well.uy;
    const du = dz * well.uz + dy * well.uy;
    const v = rz * well.vz + ry * well.vy;
    const dv = dz * well.vz + dy * well.vy;
    for (let k = 1; k < SKYLIGHTS.panes; k++) {
      const barX = -SKYLIGHTS.halfLength + k * PANE;
      enter = -Infinity;
      exit = Infinity;
      if (!clipAxis(x, dx, barX - half, barX + half)) continue;
      if (!clipAxis(u, du, 0, well.span)) continue;
      if (!clipAxis(v, dv, SKYLIGHTS.barDepth - half, SKYLIGHTS.barDepth + half)) continue;
      if (enter >= 0 && enter < first) {
        first = enter;
        barThrough = exit - enter;
      }
    }
  }
  return first;
}

/** The segment's entry and exit, as fractions of it, narrowed one axis at a time. */
let enter = 0;
let exit = 1;
/** How far the segment's line runs on inside the solid it last met, as a fraction of it. */
let through = 0;
/** The same for the glazing bar it meets first. */
let barThrough = 0;

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
  enter = -Infinity;
  exit = Infinity;
  if (!clipAxis(x, dx, box.minX, box.maxX)) return Infinity;
  if (!clipAxis(y, dy, box.bottom, box.top)) return Infinity;
  if (!clipAxis(z, dz, box.minZ, box.maxZ)) return Infinity;
  if (enter < 0) return Infinity;
  through = exit - enter;
  return enter;
}

/** The stretch of the line p + t * d inside a round outline, as `lineInRings` found it. */
let spanEnter = 0;
let spanExit = 0;

/**
 * Whether the line p + t * d passes through the outline `rings` of a round solid, and where
 * (`spanEnter` to `spanExit`). The outline is convex, so the stretches through its sections, each a
 * cone frustum, join into one.
 */
function lineInRings(
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
  solid: RoundSolid,
  rings: readonly Ring[],
): boolean {
  // Across the axis, with an oval's depth stretched back to round.
  const ox = x - solid.x;
  const oz = (z - solid.z) / solid.depthScale;
  const ddz = dz / solid.depthScale;
  const flat = dx * dx + ddz * ddz;
  const across = ox * dx + oz * ddz;
  const away = ox * ox + oz * oz;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i + 1 < rings.length; i++) {
    const r0 = rings[i]![0];
    const y0 = rings[i]![1];
    const r1 = rings[i + 1]![0];
    const y1 = rings[i + 1]![1];
    if (y1 <= y0) continue;
    // Between the section's two heights.
    let a = -Infinity;
    let b = Infinity;
    if (Math.abs(dy) >= 1e-12) {
      a = (y0 - y) / dy;
      b = (y1 - y) / dy;
      if (a > b) {
        const swap = a;
        a = b;
        b = swap;
      }
    } else if (y < y0 || y > y1) {
      continue;
    }
    // Within the cone through its two rings: the squared distance from the axis less the squared
    // radius at that height is A t^2 + B t + C, which must not be positive.
    const slope = (r1 - r0) / (y1 - y0);
    const w = r0 + slope * (y - y0);
    const wd = slope * dy;
    const A = flat - wd * wd;
    const B = 2 * (across - w * wd);
    const C = away - w * w;
    let q0 = -Infinity;
    let q1 = Infinity;
    if (Math.abs(A) < 1e-12) {
      if (Math.abs(B) < 1e-12) {
        if (C > 0) continue;
      } else if (B > 0) {
        q1 = -C / B;
      } else {
        q0 = -C / B;
      }
    } else {
      const disc = B * B - 4 * A * C;
      if (A > 0) {
        if (disc < 0) continue;
        const root = Math.sqrt(disc);
        q0 = (-B - root) / (2 * A);
        q1 = (-B + root) / (2 * A);
      } else if (disc > 0) {
        // Steeper than the cone, the line is inside it before one root and after the other, on
        // the cone's two halves; only the half this section belongs to lies between its heights.
        const root = Math.sqrt(disc);
        const first = (-B + root) / (2 * A);
        if (first >= a) q1 = first;
        else q0 = (-B - root) / (2 * A);
      }
    }
    const l = Math.max(a, q0);
    const h = Math.min(b, q1);
    if (l > h) continue;
    if (l < lo) lo = l;
    if (h > hi) hi = h;
  }
  if (lo > hi) return false;
  spanEnter = lo;
  spanExit = hi;
  return true;
}

/**
 * Where a segment meets a round solid, as a fraction of it; Infinity if it misses. A lamp shade is
 * hollow and open below: a knife that flies up into it through the rim meets the inside of the
 * shade where it would leave the hollow, unless it drops back out through the rim.
 */
function segmentRound(
  x: number,
  y: number,
  z: number,
  dx: number,
  dy: number,
  dz: number,
  solid: RoundSolid,
): number {
  if (!lineInRings(x, y, z, dx, dy, dz, solid, solid.rings)) return Infinity;
  const outerEnter = spanEnter;
  const outerExit = spanExit;
  if (outerExit < 0 || outerEnter > 1) return Infinity;
  const hollow = solid.hollow;
  if (hollow !== null && lineInRings(x, y, z, dx, dy, dz, solid, hollow)) {
    // The hollow shares the outline's bottom, so a line in through the rim enters both at once.
    if (spanEnter <= outerEnter) {
      if (spanExit < 0) return Infinity;
      if (dy < 0 && spanExit >= (hollow[0]![1] - y) / dy) return Infinity;
      through = outerExit - spanExit;
      return spanExit;
    }
    if (outerEnter < 0) return Infinity;
    through = spanEnter - outerEnter;
    return outerEnter;
  }
  if (outerEnter < 0) return Infinity;
  through = outerExit - outerEnter;
  return outerEnter;
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
