import {
  Box3,
  Euler,
  FrontSide,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Quaternion,
  Ray,
  Raycaster,
  Vector3,
} from 'three';
import {
  EYE_HEIGHT,
  KITCHEN,
  KNIFE_SOLIDS,
  ROOM_HALF_X,
  ROOM_HALF_Z,
  SPAWN,
  WINDOWS,
  spawnPoint,
  vaultHeight,
  type Footprint,
  type KnifeSolid,
} from '@world/shared';
import { describe, expect, it } from 'vitest';
import { SKYLIGHT_OPENINGS } from '../world/kitchen.ts';
import { paintOutside } from '../world/outside.ts';
import { lookAt } from '../world/timeOfDay.ts';
import { LAP_SECONDS, LOOP, LOOP_LENGTH, LandingCamera, loopAt } from './landingCamera.ts';

/** In plan, the camera keeps this far from every counter, rack and unit standing on the floor. */
const FOOTPRINT_CLEARANCE = 0.5;
/** And this far from anything drawn: the walls, the tops of the counters, the hood, lamps and props. */
const CLEARANCE = 0.75;

const FRAME = 1 / 60;
const floorFixtures = Object.entries(KITCHEN).filter(([, f]) => !('bottom' in f));

function planDistance(f: Footprint, x: number, z: number): number {
  return Math.hypot(Math.max(f.minX - x, 0, x - f.maxX), Math.max(f.minZ - z, 0, z - f.maxZ));
}

function solidDistance(s: KnifeSolid, p: Vector3): number {
  return Math.hypot(
    Math.max(s.minX - p.x, 0, p.x - s.maxX),
    Math.max(s.bottom - p.y, 0, p.y - s.top),
    Math.max(s.minZ - p.z, 0, p.z - s.maxZ),
  );
}

/** What the camera at `p` is too close to, if anything. */
function tooClose(p: Vector3): string[] {
  const near: string[] = [];
  for (const [name, f] of floorFixtures) {
    if (planDistance(f, p.x, p.z) < FOOTPRINT_CLEARANCE) near.push(name);
  }
  KNIFE_SOLIDS.forEach((s, i) => {
    if (solidDistance(s, p) < CLEARANCE) near.push(`solid ${i}`);
  });
  if (ROOM_HALF_X - Math.abs(p.x) < CLEARANCE) near.push('an end wall');
  if (ROOM_HALF_Z - Math.abs(p.z) < CLEARANCE) near.push('a long wall');
  if (vaultHeight(p.z) - p.y < CLEARANCE) near.push('the vault');
  return near;
}

function where(p: Vector3): string {
  return `(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)})`;
}

function forward(camera: PerspectiveCamera, out: Vector3): Vector3 {
  return out.set(0, 0, -1).applyQuaternion(camera.quaternion);
}

/**
 * Whatever the camera looks straight at is at least this far away: it never stares at a wall. A post
 * or a leg slipping past the middle of the view does not count, only what is a hand's width across.
 */
const SIGHTLINE = 2.5;
const SIZABLE = KNIFE_SOLIDS.filter((s) => s.maxX - s.minX >= 0.1 && s.maxZ - s.minZ >= 0.1);
const ray = new Ray();
const box = new Box3();
const hit = new Vector3();

/** How far the camera sees straight ahead before it meets anything sizable, a wall or the floor. */
function sightline(camera: PerspectiveCamera): number {
  const { origin, direction } = ray;
  origin.copy(camera.position);
  forward(camera, direction);
  let nearest = Infinity;
  if (direction.x !== 0) {
    nearest = Math.min(nearest, (Math.sign(direction.x) * ROOM_HALF_X - origin.x) / direction.x);
  }
  if (direction.z !== 0) {
    nearest = Math.min(nearest, (Math.sign(direction.z) * ROOM_HALF_Z - origin.z) / direction.z);
  }
  if (direction.y < 0) nearest = Math.min(nearest, -origin.y / direction.y);
  for (const s of SIZABLE) {
    box.min.set(s.minX, s.bottom, s.minZ);
    box.max.set(s.maxX, s.top, s.maxZ);
    if (ray.intersectBox(box, hit)) nearest = Math.min(nearest, hit.distanceTo(origin));
  }
  return nearest;
}

/** The swoop from `u` on the loop to a cook at `spawn`, as `game.ts` drives it, frame by frame. */
function swoopFrom(
  u: number,
  spawn: { x: number; z: number; yaw: number },
  onFrame: (camera: PerspectiveCamera, progress: number) => void,
  welcome?: { at: number; spawn: { x: number; z: number } },
): { camera: PerspectiveCamera; seconds: number; facing: Quaternion } {
  const view = new LandingCamera();
  const camera = new PerspectiveCamera(72, 16 / 10, 0.05, 200);
  view.update(camera, (u - loopAt(0) + 1) * LAP_SECONDS, false);
  const facing = new Quaternion().setFromEuler(new Euler(0, spawn.yaw, 0, 'YXZ'));
  // As in the game, the swoop is planned for the room's first spawn point; the room may then place
  // the cook elsewhere along the aisle.
  view.planSwoop(camera.position, camera.quaternion, SPAWN.x, SPAWN.z, facing);
  let progress = 0;
  while (progress < 1) {
    progress = Math.min(1, progress + FRAME / view.swoopSeconds);
    const at = welcome && progress >= welcome.at ? welcome.spawn : spawn;
    view.swoop(camera, progress, at.x, at.z, facing);
    camera.updateMatrixWorld();
    onFrame(camera, progress);
  }
  return { camera, seconds: view.swoopSeconds, facing };
}

describe('the camera behind the landing', () => {
  it('walks the loop at head height, clear of every fixture and wall', () => {
    const point = new Vector3();
    const problems: string[] = [];
    for (let i = 0; i < 6000; i++) {
      LOOP.getPointAt(i / 6000, point);
      if (point.y < 1.7 || point.y > 1.9) problems.push(`${where(point)} at ${point.y}`);
      const near = tooClose(point);
      if (near.length > 0) problems.push(`${where(point)} near ${near.join(', ')}`);
    }
    expect(problems).toEqual([]);
  });

  it('keeps an even pace, about two minutes a lap', () => {
    expect(LAP_SECONDS).toBe(120);
    const speed = LOOP_LENGTH / LAP_SECONDS;
    expect(speed).toBeGreaterThan(0.2);
    expect(speed).toBeLessThan(0.4);
    const a = new Vector3();
    const b = new Vector3();
    for (let t = 0; t < LAP_SECONDS; t += FRAME) {
      LOOP.getPointAt(loopAt(t), a);
      LOOP.getPointAt(loopAt(t + FRAME), b);
      expect(a.distanceTo(b) / FRAME).toBeCloseTo(speed, 2);
    }
  });

  it('looks ahead and a little in toward the suite, turning smoothly', () => {
    const view = new LandingCamera();
    const camera = new PerspectiveCamera(72, 16 / 10, 0.05, 200);
    const look = new Vector3();
    const last = new Vector3();
    const ahead = new Vector3();
    const inward = new Vector3();
    let fastestTurn = 0;
    for (let t = 0; t <= LAP_SECONDS; t += FRAME) {
      view.update(camera, t, false);
      forward(camera, look);
      if (t > 0) fastestTurn = Math.max(fastestTurn, look.angleTo(last) / FRAME);
      last.copy(look);
      // Ahead: well within a right angle of the way the camera goes, even as it looks round a
      // corner. In: turned from there toward the middle of the suite.
      LOOP.getPointAt(loopAt(t + 0.5), ahead)
        .sub(camera.position)
        .setY(0)
        .normalize();
      inward.set(-camera.position.x, 0, -camera.position.z).normalize();
      const flat = look.clone().setY(0).normalize();
      expect(flat.dot(ahead), `ahead at ${t.toFixed(1)} s`).toBeGreaterThan(
        Math.cos((65 * Math.PI) / 180),
      );
      expect(flat.dot(inward) - ahead.dot(inward), `in at ${t.toFixed(1)} s`).toBeGreaterThan(0);
      // A little down, toward the counters, never at the floor or the vault, or close up at anything.
      expect(look.y).toBeLessThan(0);
      expect(look.y).toBeGreaterThan(-0.3);
      expect(sightline(camera), `sight at ${t.toFixed(1)} s`).toBeGreaterThan(SIGHTLINE);
    }
    // Under 15 degrees a second, even round the corners.
    expect((fastestTurn * 180) / Math.PI).toBeLessThan(15);
  });

  it('holds the still establishing shot when motion is reduced', () => {
    const view = new LandingCamera();
    const camera = new PerspectiveCamera();
    view.update(camera, 0, true);
    const position = camera.position.clone();
    const quaternion = camera.quaternion.clone();
    for (const t of [3, 40, 90]) {
      view.update(camera, t, true);
      expect(camera.position.equals(position)).toBe(true);
      expect(camera.quaternion.equals(quaternion)).toBe(true);
    }
  });

  it('starts every cook in the aisle behind the pass, which the swoop glides along', () => {
    for (let t = 0; t < 1; t += 0.01) {
      const spawn = spawnPoint(t);
      expect(spawn.z).toBe(SPAWN.z);
      expect(Math.abs(spawn.x)).toBeLessThanOrEqual(4.2);
    }
  });

  it('swoops into the game from anywhere on the loop without coming near anything', () => {
    const problems: string[] = [];
    const lastPosition = new Vector3();
    const look = new Vector3();
    const lastLook = new Vector3();
    let fastest = 0;
    let fastestTurn = 0;
    let longest = 0;
    for (let i = 0; i < 120; i++) {
      // Spawn points from the middle of the aisle to both its ends.
      for (const t of [0, 0.25, 0.4999, 0.5, 0.75]) {
        const spawn = spawnPoint(t);
        const view = new LandingCamera();
        const start = new PerspectiveCamera();
        view.update(start, (i / 120) * LAP_SECONDS, false);
        const startPosition = start.position.clone();
        const startLook = forward(start, new Vector3());
        lastPosition.copy(startPosition);
        lastLook.copy(startLook);
        let frame = 0;
        const { camera, seconds, facing } = swoopFrom(loopAt(0) + i / 120, spawn, (camera) => {
          const near = tooClose(camera.position);
          if (near.length > 0) problems.push(`${where(camera.position)} near ${near.join(', ')}`);
          if (frame++ % 6 === 0 && sightline(camera) < SIGHTLINE) {
            problems.push(`${where(camera.position)} looks close up at something`);
          }
          fastest = Math.max(fastest, camera.position.distanceTo(lastPosition) / FRAME);
          forward(camera, look);
          fastestTurn = Math.max(fastestTurn, look.angleTo(lastLook) / FRAME);
          lastPosition.copy(camera.position);
          lastLook.copy(look);
        });
        longest = Math.max(longest, seconds);
        expect(camera.position.distanceTo(new Vector3(spawn.x, EYE_HEIGHT, spawn.z))).toBeLessThan(
          1e-6,
        );
        expect(camera.quaternion.angleTo(facing)).toBeLessThan(1e-6);
      }
    }
    expect(problems).toEqual([]);
    // Never faster than the old straight swoop at its peak (12.6 m/s), turning evenly, in four and a half seconds at most.
    expect(fastest).toBeLessThan(12.6);
    expect((fastestTurn * 180) / Math.PI).toBeLessThan(125);
    expect(longest).toBeLessThanOrEqual(4.5);
  });

  it('follows the cook to where the room places them, without a jump', () => {
    // The room's welcome places the cook along the aisle a moment after the swoop sets off.
    for (const u of [0, 0.3, 0.6, 0.9]) {
      const last = new Vector3();
      let first = true;
      let biggest = 0;
      const placed = spawnPoint(0.5);
      swoopFrom(
        loopAt(0) + u,
        SPAWN,
        (camera) => {
          if (!first) biggest = Math.max(biggest, camera.position.distanceTo(last));
          first = false;
          last.copy(camera.position);
        },
        { at: 0.12, spawn: placed },
      );
      expect(last.distanceTo(new Vector3(placed.x, EYE_HEIGHT, placed.z))).toBeLessThan(1e-6);
      expect(biggest).toBeLessThan(0.2);
    }
  });

  // Thousands of raycasts at the whole view outside: a couple of seconds alone, far more on a busy
  // machine, so it gets more than the default five.
  it('sees the view outside through every pane and skylight, all the way round', () => {
    const outside = paintOutside(lookAt(19.8));
    const mesh = new Mesh(outside.geometry, new MeshBasicMaterial({ side: FrontSide }));
    const raycaster = new Raycaster();
    const eye = new Vector3();
    const point = new Vector3();
    const misses: string[] = [];
    const sees = (from: Vector3): boolean => {
      raycaster.set(from, from.clone().sub(eye).normalize());
      return raycaster.intersectObject(mesh, false).length > 0;
    };
    for (let i = 0; i < 24; i++) {
      LOOP.getPointAt(i / 24, eye);
      for (let j = 0; j <= 12; j++) {
        const u = WINDOWS.from + ((WINDOWS.to - WINDOWS.from) * j) / 12;
        for (const v of [WINDOWS.bottom, WINDOWS.top]) {
          if (!sees(point.set(u, v, -ROOM_HALF_Z - 0.25))) misses.push(`${where(eye)} pane`);
        }
      }
      for (const [a, b, , d] of SKYLIGHT_OPENINGS) {
        for (let j = 0; j <= 6; j++) {
          for (const v of [0.05, 0.95]) {
            point
              .copy(a!)
              .lerp(b!, j / 6)
              .addScaledVector(d!.clone().sub(a!), v);
            if (!sees(point)) misses.push(`${where(eye)} skylight`);
          }
        }
      }
    }
    expect(misses).toEqual([]);
  }, 30_000);
});
