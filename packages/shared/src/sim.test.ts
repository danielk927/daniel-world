import { describe, expect, it } from 'vitest';
import {
  JUMP_SPEED,
  GRAVITY,
  Keys,
  PLAY_RADIUS,
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
import { COLLIDERS, FOUNTAIN, RUIN_BLOCKS, terrainHeight } from './world.ts';

function run(state: PlayerState, input: PlayerInput, ticks: number): PlayerState {
  for (let i = 0; i < ticks; i++) stepPlayer(state, input);
  return state;
}

const idle: PlayerInput = { keys: 0, yaw: 0, pitch: 0 };

describe('stepPlayer', () => {
  it('keeps an idle player at rest on the ground', () => {
    const s = run(createPlayerState(), idle, TICK_RATE * 2);
    expect(s.x).toBe(0);
    expect(s.z).toBe(7.5);
    expect(s.y).toBeCloseTo(terrainHeight(0, 7.5));
    expect(s.grounded).toBe(true);
  });

  it('walks forward (-Z at yaw 0) at walk speed', () => {
    const s = createPlayerState(0, 10, 0);
    run(s, { keys: Keys.Forward, yaw: 0, pitch: 0 }, TICK_RATE);
    expect(Math.hypot(s.vx, s.vz)).toBeCloseTo(WALK_SPEED, 3);
    expect(s.vz).toBeLessThan(0);
    // Roughly one second of walking, minus a little acceleration time.
    expect(10 - s.z).toBeGreaterThan(WALK_SPEED - 0.5);
    expect(10 - s.z).toBeLessThan(WALK_SPEED);
  });

  it('turns movement with yaw (yaw +90deg looks down -X)', () => {
    const s = createPlayerState(0, 8, 0);
    run(s, { keys: Keys.Forward, yaw: Math.PI / 2, pitch: 0 }, 10);
    expect(s.x).toBeLessThan(-1);
    expect(Math.abs(s.z - 8)).toBeLessThan(1e-3);
  });

  it('sprints faster and does not move faster diagonally', () => {
    const sprint = run(
      createPlayerState(),
      { keys: Keys.Back | Keys.Sprint, yaw: 0, pitch: 0 },
      10,
    );
    expect(Math.hypot(sprint.vx, sprint.vz)).toBeCloseTo(SPRINT_SPEED, 3);
    const diagonal = run(
      createPlayerState(),
      { keys: Keys.Back | Keys.Right, yaw: 0, pitch: 0 },
      10,
    );
    expect(Math.hypot(diagonal.vx, diagonal.vz)).toBeCloseTo(WALK_SPEED, 3);
  });

  it('jumps to the expected apex and lands again', () => {
    const s = createPlayerState(0, 7.5, 0);
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

  it('cannot walk through the fountain', () => {
    const s = run(createPlayerState(0, 7.5, 0), { keys: Keys.Forward, yaw: 0, pitch: 0 }, 60);
    expect(s.z).toBeGreaterThanOrEqual(FOUNTAIN.basinRadius + PLAYER_RADIUS - 1e-3);
  });

  it('never leaves the play area', () => {
    const s = createPlayerState(0, 0, 0);
    s.z = -20;
    run(s, { keys: Keys.Forward | Keys.Sprint, yaw: 0.3, pitch: 0 }, TICK_RATE * 10);
    expect(Math.hypot(s.x, s.z)).toBeLessThanOrEqual(PLAY_RADIUS + 1e-3);
  });

  it('walks up the west stairs onto the lookout platform', () => {
    const platform = RUIN_BLOCKS[RUIN_BLOCKS.length - 1]!;
    const s = createPlayerState(-17, 0, Math.PI / 2);
    run(s, { keys: Keys.Forward, yaw: Math.PI / 2, pitch: 0 }, 44);
    expect(s.x).toBeLessThan(platform.maxX);
    expect(s.x).toBeGreaterThan(platform.minX);
    expect(s.y).toBeCloseTo(platform.top, 3);
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

describe('wrapAngle', () => {
  it('wraps into [-PI, PI)', () => {
    expect(wrapAngle(0)).toBe(0);
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(-Math.PI);
    expect(wrapAngle(-Math.PI * 2.5)).toBeCloseTo(-Math.PI / 2);
  });
});

describe('world layout', () => {
  it('has a clear spawn point', () => {
    const s = createPlayerState();
    const before = { x: s.x, z: s.z };
    stepPlayer(s, idle);
    expect({ x: s.x, z: s.z }).toEqual(before);
  });

  it('only contains finite colliders', () => {
    for (const c of COLLIDERS) {
      expect(Number.isFinite(c.top) && Number.isFinite(c.bottom)).toBe(true);
      expect(c.top).toBeGreaterThan(c.bottom);
    }
  });
});
