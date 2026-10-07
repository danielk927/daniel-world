import { describe, expect, it } from 'vitest';
import {
  JUMP_SPEED,
  GRAVITY,
  Keys,
  PLAY_HALF_X,
  PLAY_HALF_Z,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  SPRINT_SPEED,
  TICK_RATE,
  WALK_SPEED,
} from './constants.ts';
import {
  createPlayerState,
  stepPlayer,
  wrapAngle,
  type PlayerInput,
  type PlayerState,
} from './sim.ts';
import {
  COLLIDERS,
  KITCHEN,
  PASS_DISHES,
  SPAWN,
  STATIONS,
  spawnPoint,
  type BoxCollider,
} from './world.ts';

/** The aisle between the piano and the pass, where the line cooks stand. */
const LINE_Z = 2.9;

function run(state: PlayerState, input: PlayerInput, ticks: number): PlayerState {
  for (let i = 0; i < ticks; i++) stepPlayer(state, input);
  return state;
}

/** This many seconds of simulation, in ticks. */
const seconds = (s: number): number => Math.round(s * TICK_RATE);
const idle: PlayerInput = { keys: 0, yaw: 0, pitch: 0 };

describe('stepPlayer', () => {
  it('keeps an idle player at rest on the ground', () => {
    const s = run(createPlayerState(), idle, TICK_RATE * 2);
    expect(s.x).toBe(SPAWN.x);
    expect(s.z).toBe(SPAWN.z);
    expect(s.y).toBe(0);
    expect(s.grounded).toBe(true);
  });

  it('walks forward (-Z at yaw 0) at walk speed', () => {
    // The open floor west of the piano and the pastry island.
    const s = createPlayerState(-6.5, 2.6, 0);
    run(s, { keys: Keys.Forward, yaw: 0, pitch: 0 }, TICK_RATE);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(WALK_SPEED, 3);
    expect(s.vz).toBeLessThan(0);
    // Roughly one second of walking, minus a little acceleration time.
    expect(2.6 - s.z).toBeGreaterThan(WALK_SPEED - 0.5);
    expect(2.6 - s.z).toBeLessThan(WALK_SPEED);
  });

  it('turns movement with yaw (yaw +90deg looks down -X)', () => {
    const s = createPlayerState();
    run(s, { keys: Keys.Forward, yaw: Math.PI / 2, pitch: 0 }, seconds(0.5));
    expect(s.x).toBeLessThan(-1);
    expect(Math.abs(s.z - SPAWN.z)).toBeLessThan(1e-3);
  });

  it('sprints faster and does not move faster diagonally', () => {
    const sprint = run(
      createPlayerState(),
      { keys: Keys.Left | Keys.Sprint, yaw: 0, pitch: 0 },
      seconds(0.5),
    );
    expect(Math.hypot(sprint.vx, sprint.vz)).toBeCloseTo(SPRINT_SPEED, 3);
    // In the line, between the pass and the piano: a quarter second is enough to reach full speed.
    const diagonal = run(
      createPlayerState(0, LINE_Z),
      { keys: Keys.Forward | Keys.Left, yaw: 0, pitch: 0 },
      seconds(0.25),
    );
    expect(Math.hypot(diagonal.vx, diagonal.vz)).toBeCloseTo(WALK_SPEED, 3);
  });

  it('jumps to the expected apex and lands again', () => {
    const s = createPlayerState();
    const ground = s.y;
    let apex = ground;
    stepPlayer(s, { keys: Keys.Jump, yaw: 0, pitch: 0 });
    expect(s.grounded).toBe(false);
    for (let i = 0; i < TICK_RATE * 2; i++) {
      stepPlayer(s, idle);
      apex = Math.max(apex, s.y);
    }
    const ideal = (JUMP_SPEED * JUMP_SPEED) / (2 * GRAVITY);
    expect(apex - ground).toBeGreaterThan(ideal * 0.9);
    expect(apex - ground).toBeLessThan(ideal * 1.05);
    expect(s.grounded).toBe(true);
    expect(s.y).toBeCloseTo(ground);
  });

  it('cannot walk through the piano', () => {
    const s = run(
      createPlayerState(0, LINE_Z),
      { keys: Keys.Forward, yaw: 0, pitch: 0 },
      seconds(3),
    );
    expect(s.z).toBeCloseTo(KITCHEN.piano.maxZ + PLAYER_RADIUS, 3);
  });

  it('never leaves the kitchen', () => {
    // Sprint into the west wall by the back door, then along it.
    const s = createPlayerState(-6, 4.4, 0);
    run(s, { keys: Keys.Left | Keys.Sprint, yaw: 0, pitch: 0 }, TICK_RATE * 2);
    expect(s.x).toBeCloseTo(-PLAY_HALF_X, 3);
    run(s, { keys: Keys.Back | Keys.Left | Keys.Sprint, yaw: 0, pitch: 0 }, TICK_RATE * 2);
    expect(s.x).toBeGreaterThanOrEqual(-PLAY_HALF_X);
    // And into the south wall, in the aisle by the dining room doors.
    const t = createPlayerState(-5, 5.2, 0);
    run(t, { keys: Keys.Back | Keys.Sprint, yaw: 0, pitch: 0 }, TICK_RATE * 2);
    expect(t.z).toBeCloseTo(PLAY_HALF_Z, 3);
  });

  it('bumps its head on the hood when jumping beside the piano', () => {
    const s = run(
      createPlayerState(0, LINE_Z),
      { keys: Keys.Forward, yaw: 0, pitch: 0 },
      seconds(2),
    );
    let highest = 0;
    stepPlayer(s, { keys: Keys.Jump, yaw: 0, pitch: 0 });
    for (let i = 0; i < seconds(1); i++) {
      stepPlayer(s, idle);
      highest = Math.max(highest, s.y);
    }
    expect(highest + PLAYER_HEIGHT).toBeCloseTo(KITCHEN.hood.bottom, 3);
    expect(s.grounded).toBe(true);
  });

  it('is deterministic for the same input sequence', () => {
    const inputs: PlayerInput[] = [];
    for (let i = 0; i < 400; i++) {
      inputs.push({
        keys: (i * 7) % 64,
        yaw: Math.sin(i * 0.05) * 3,
        pitch: Math.cos(i * 0.03),
      });
    }
    const a = createPlayerState();
    const b = createPlayerState();
    for (const input of inputs) stepPlayer(a, input);
    for (const input of inputs) stepPlayer(b, { ...input });
    expect(a).toEqual(b);
  });

  it('survives a JSON round trip without drifting', () => {
    const a = createPlayerState();
    const input: PlayerInput = {
      keys: Keys.Forward | Keys.Left | Keys.Jump,
      yaw: 1.2345,
      pitch: 0.1,
    };
    for (let i = 0; i < 50; i++) {
      stepPlayer(a, input);
      const b = JSON.parse(JSON.stringify(a)) as PlayerState;
      expect(b).toEqual(a);
    }
  });
});

describe('collision edge cases', () => {
  const box: BoxCollider = {
    kind: 'box',
    minX: -1,
    maxX: 1,
    minZ: -1,
    maxZ: 1,
    bottom: 2.5,
    top: 3,
  };

  it('bumps its head on an overhang instead of passing through', () => {
    const s = createPlayerState(20, 0, 0);
    s.x = 0;
    s.z = 0;
    s.y = 0;
    let highest = 0;
    stepPlayer(s, { keys: Keys.Jump, yaw: 0, pitch: 0 }, [box]);
    for (let i = 0; i < seconds(1); i++) {
      stepPlayer(s, idle, [box]);
      highest = Math.max(highest, s.y);
    }
    expect(highest + 1.8).toBeLessThanOrEqual(box.bottom + 1e-3);
  });

  it('leaves a box through the nearest face when spawned inside it', () => {
    const wall: BoxCollider = {
      kind: 'box',
      minX: -1,
      maxX: 3,
      minZ: -1,
      maxZ: 1,
      bottom: -1,
      top: 5,
    };
    const s = createPlayerState(0, 0, 0);
    s.x = -0.5;
    s.z = 0.2;
    s.y = 0;
    stepPlayer(s, idle, [wall]);
    expect(s.x).toBeCloseTo(-1 - PLAYER_RADIUS, 3);
  });

  it('lands on a platform even when falling fast', () => {
    const platform: BoxCollider = {
      kind: 'box',
      minX: -2,
      maxX: 2,
      minZ: -2,
      maxZ: 2,
      bottom: -1,
      top: 1,
    };
    const s = createPlayerState(0, 0, 0);
    s.x = 0;
    s.z = 0;
    s.y = 12;
    for (let i = 0; i < seconds(2); i++) stepPlayer(s, idle, [platform]);
    expect(s.y).toBeCloseTo(1, 3);
    expect(s.grounded).toBe(true);
  });

  it('cannot climb onto a counter', () => {
    // Jump at the pass, in front of the spawn point, over and over.
    const s = createPlayerState();
    for (let i = 0; i < seconds(3); i++) {
      stepPlayer(s, { keys: Keys.Forward | Keys.Jump, yaw: 0, pitch: 0 });
      if (s.grounded) expect(s.y).toBe(0);
    }
    expect(s.z).toBeCloseTo(KITCHEN.pass.maxZ + PLAYER_RADIUS, 3);
  });

  it('ignores non-finite look input', () => {
    const s = createPlayerState();
    stepPlayer(s, { keys: Keys.Forward, yaw: Number.NaN, pitch: Number.POSITIVE_INFINITY });
    expect(Number.isFinite(s.x + s.z + s.yaw + s.pitch)).toBe(true);
  });
});

describe('wrapAngle', () => {
  it('wraps into [-PI, PI)', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(-Math.PI);
    expect(wrapAngle(-Math.PI * 2.5)).toBeCloseTo(-Math.PI / 2);
  });
});

describe('world layout', () => {
  it('spreads spawn points along the aisle, facing the piano', () => {
    expect(spawnPoint(0)).toEqual(SPAWN);
    const xs = new Set<number>();
    for (const t of [0.1, 0.37, 0.5, 0.83, 0.99]) {
      const p = spawnPoint(t);
      xs.add(p.x);
      expect(p.z).toBe(SPAWN.z);
      expect(p.yaw).toBe(0);
      expect(Math.abs(p.x)).toBeLessThanOrEqual(KITCHEN.piano.maxX);
      // A clear spot: one idle step does not push the player anywhere.
      const s = createPlayerState(p.x, p.z, p.yaw);
      stepPlayer(s, { keys: 0, yaw: p.yaw, pitch: 0 });
      expect(Math.hypot(s.x - p.x, s.z - p.z)).toBeLessThan(1e-3);
    }
    expect(xs.size).toBe(5);
  });

  it('has a clear spawn point', () => {
    const s = createPlayerState();
    const before = { x: s.x, z: s.z };
    stepPlayer(s, idle);
    expect({ x: s.x, z: s.z }).toEqual(before);
  });

  it('puts every station above a fixture, where players cannot stand', () => {
    for (const station of STATIONS) {
      const covered = COLLIDERS.some(
        (c) =>
          c.kind === 'box' &&
          station.x >= c.minX &&
          station.x <= c.maxX &&
          station.z >= c.minZ &&
          station.z <= c.maxZ &&
          c.bottom < station.y &&
          c.top > station.y,
      );
      expect(covered, station.id).toBe(true);
    }
    expect(new Set(STATIONS.map((s) => s.id)).size).toBe(STATIONS.length);
  });

  it('sets every dish on the pass, without two plates overlapping', () => {
    const { pass } = KITCHEN;
    for (const dish of PASS_DISHES) {
      expect(dish.x - dish.radius, dish.id).toBeGreaterThan(pass.minX);
      expect(dish.x + dish.radius, dish.id).toBeLessThan(pass.maxX);
      expect(dish.z, dish.id).toBeGreaterThan(pass.minZ);
      expect(dish.z, dish.id).toBeLessThan(pass.maxZ);
      expect(dish.y, dish.id).toBeGreaterThan(pass.top);
    }
    for (let i = 1; i < PASS_DISHES.length; i++) {
      const [a, b] = [PASS_DISHES[i - 1]!, PASS_DISHES[i]!];
      expect(b.x - a.x, `${a.id} / ${b.id}`).toBeGreaterThan(a.radius + b.radius);
    }
    expect(new Set(PASS_DISHES.map((d) => d.id)).size).toBe(PASS_DISHES.length);
  });

  it('only contains finite colliders', () => {
    for (const c of COLLIDERS) {
      expect(Number.isFinite(c.top) && Number.isFinite(c.bottom)).toBe(true);
      expect(c.top).toBeGreaterThan(c.bottom);
    }
  });
});
