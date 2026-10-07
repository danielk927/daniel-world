import { describe, expect, it } from 'vitest';
import {
  EYE_HEIGHT,
  KNIFE_EMBED,
  KNIFE_MAX_FLIGHT_SECONDS,
  Keys,
  PLAY_HALF_X,
  PLAYER_HEIGHT,
  PLAYER_RADIUS,
  ROOM_HALF_X,
  TICK_RATE,
} from './constants.ts';
import {
  COOLER_HITS_TO_OPEN,
  PUNCH_REACH,
  coolerBurst,
  knifeInCoolerDoor,
  punchOnCoolerDoor,
} from './cooler.ts';
import { flyKnife, launchKnife, type KnifeImpact } from './knife.ts';
import {
  createPlayerState,
  isInsideCollider,
  stepPlayer,
  type PlayerInput,
  type PlayerState,
} from './sim.ts';
import {
  COLLIDERS,
  COOLER,
  COOLER_DOOR,
  DOORS,
  OPEN_COOLER_COLLIDERS,
  coolerColliders,
  inPlayArea,
} from './world.ts';

const EAST = -Math.PI / 2;
const NORTH = 0;
const SOUTH = Math.PI;
/** In front of the walk-in, in the middle of its doorway. */
const DOOR_Z = (DOORS.walkIn.from + DOORS.walkIn.to) / 2;
/** On the east wall south of the walk-in, before the fridge. */
const BESIDE_DOOR_Z = -1.5;

function throwFrom(
  x: number,
  y: number,
  z: number,
  yaw: number,
  pitch: number,
  coolerOpen: boolean,
): KnifeImpact | null {
  const knife = launchKnife(x, y, z, yaw, pitch);
  for (let i = 0; i < 200; i++) {
    const impact = flyKnife(knife, 1 / 20, [], -1, coolerOpen);
    if (impact) return impact;
    if (knife.t >= KNIFE_MAX_FLIGHT_SECONDS) return null;
  }
  return null;
}

function walk(state: PlayerState, input: PlayerInput, seconds: number, open: boolean): PlayerState {
  for (let i = 0; i < Math.round(seconds * TICK_RATE); i++) {
    stepPlayer(state, input, coolerColliders(open));
  }
  return state;
}

describe("a punch at the walk-in's door", () => {
  it('lands where the eye looks, when the door is within reach', () => {
    const eye = { x: ROOM_HALF_X - 0.7, y: EYE_HEIGHT, z: -3 };
    expect(punchOnCoolerDoor(eye.x, eye.y, eye.z, EAST, 0)).toEqual({ z: -3, y: EYE_HEIGHT });
    // Turned a little to the left (north) and down: further along the door, and lower.
    const angled = punchOnCoolerDoor(eye.x, eye.y, eye.z, EAST + 0.3, -0.3)!;
    expect(angled.z).toBeLessThan(-3);
    expect(angled.y).toBeLessThan(EYE_HEIGHT);
  });

  it('misses from out of reach, facing away, or beside the door', () => {
    const z = -3;
    expect(punchOnCoolerDoor(ROOM_HALF_X - PUNCH_REACH - 0.05, EYE_HEIGHT, z, EAST, 0)).toBeNull();
    expect(punchOnCoolerDoor(ROOM_HALF_X - 0.6, EYE_HEIGHT, z, NORTH, 0)).toBeNull();
    expect(punchOnCoolerDoor(ROOM_HALF_X - 0.6, EYE_HEIGHT, z, -EAST, 0)).toBeNull();
    // At the wall beside it, and at its frame.
    expect(punchOnCoolerDoor(ROOM_HALF_X - 0.6, EYE_HEIGHT, 0, EAST, 0)).toBeNull();
    expect(
      punchOnCoolerDoor(ROOM_HALF_X - 0.6, EYE_HEIGHT, DOORS.walkIn.from - 0.03, EAST, 0),
    ).toBeNull();
    // Over it, looking up.
    expect(punchOnCoolerDoor(ROOM_HALF_X - 0.4, EYE_HEIGHT, z, EAST, 1.2)).toBeNull();
  });

  it('lands on the millimeter, so every screen dents the same spot', () => {
    const hit = punchOnCoolerDoor(7.1234567, 1.6234567, -2.9876543, EAST + 0.1234, 0.0567)!;
    expect(hit.z * 1000).toBe(Math.round(hit.z * 1000));
    expect(hit.y * 1000).toBe(Math.round(hit.y * 1000));
  });
});

describe("knives and the walk-in's door", () => {
  it('stick into the shut door, and count as a hit on it', () => {
    const hit = throwFrom(4, 1.4, DOOR_Z, EAST, 0, false);
    expect(hit?.kind).toBe('surface');
    if (hit?.kind !== 'surface') return;
    expect(hit.x).toBeCloseTo(ROOM_HALF_X + KNIFE_EMBED, 2);
    expect(knifeInCoolerDoor(hit.x, hit.y, hit.z)).toEqual({
      z: Math.round(hit.z * 1000) / 1000,
      y: Math.round(hit.y * 1000) / 1000,
    });
  });

  it('do not count stuck in the wall beside the door, the floor before it, or its frame', () => {
    const wall = throwFrom(4, 1.4, 0, EAST, 0, false);
    expect(wall?.kind === 'surface' && knifeInCoolerDoor(wall.x, wall.y, wall.z)).toBe(null);
    const floor = throwFrom(7, 1.6, DOOR_Z, EAST, -1.2, false);
    expect(floor?.kind === 'surface' && knifeInCoolerDoor(floor.x, floor.y, floor.z)).toBe(null);
    expect(knifeInCoolerDoor(ROOM_HALF_X + 0.04, 1.2, DOORS.walkIn.to + 0.05)).toBeNull();
  });

  it('fly through the open doorway and stick in the far wall of the cooler', () => {
    const hit = throwFrom(4, 1.4, DOOR_Z, EAST, 0, true);
    expect(hit?.kind).toBe('surface');
    if (hit?.kind !== 'surface') return;
    expect(hit.x).toBeCloseTo(COOLER.maxX + KNIFE_EMBED, 2);
  });

  it("stick in the cooler's walls, ceiling and open door, and the kitchen wall beside it", () => {
    const inside = { x: COOLER.minX + 1.5, y: 1.5, z: -4 };
    const north = throwFrom(inside.x, inside.y, inside.z, NORTH, 0, true);
    expect(north?.kind === 'surface' && north.z).toBeCloseTo(COOLER.minZ - KNIFE_EMBED, 2);
    const up = throwFrom(inside.x, inside.y, inside.z, NORTH, 1.4, true);
    expect(up?.kind === 'surface' && up.y).toBeCloseTo(COOLER.height + KNIFE_EMBED * 0.98, 1);
    // South, into the door lying open against the south wall.
    const door = throwFrom(inside.x, inside.y, inside.z, SOUTH, 0, true);
    expect(door?.kind === 'surface' && door.z).toBeCloseTo(
      COOLER_DOOR.hingeZ - COOLER_DOOR.thickness + KNIFE_EMBED,
      2,
    );
    // Beside the doorway the east wall is as solid as ever.
    const wall = throwFrom(4, 1.4, BESIDE_DOOR_Z, EAST, 0, true);
    expect(wall?.kind === 'surface' && wall.x).toBeCloseTo(ROOM_HALF_X + KNIFE_EMBED, 2);
    // Over the doorway, under the cooler's ceiling, the wall stops it too.
    const lintel = throwFrom(ROOM_HALF_X - 1, DOORS.walkIn.height + 0.2, DOOR_Z, EAST, 0, true);
    expect(lintel?.kind === 'surface' && lintel.x).toBeCloseTo(ROOM_HALF_X + KNIFE_EMBED, 2);
  });
});

describe('walking into the walk-in', () => {
  const towardDoor: PlayerInput = { keys: Keys.Forward, yaw: EAST, pitch: 0 };

  it('is blocked by the shut door', () => {
    const s = walk(createPlayerState(6, DOOR_Z, EAST), towardDoor, 2, false);
    expect(s.x).toBeCloseTo(PLAY_HALF_X, 3);
    expect(s.z).toBeCloseTo(DOOR_Z, 3);
  });

  it('goes through the open doorway, to the cold room’s far wall', () => {
    const s = walk(createPlayerState(6, DOOR_Z, EAST), towardDoor, 2, true);
    expect(s.x).toBeCloseTo(COOLER.maxX - PLAYER_RADIUS, 3);
    expect(isInsideCollider(s, OPEN_COOLER_COLLIDERS)).toBe(false);
    expect(inPlayArea(s.x, s.z, true)).toBe(true);
    expect(inPlayArea(s.x, s.z, false)).toBe(false);
  });

  it('still meets the east wall beside the doorway', () => {
    const s = walk(createPlayerState(6, BESIDE_DOOR_Z, EAST), towardDoor, 2, true);
    expect(s.x).toBeCloseTo(PLAY_HALF_X, 3);
  });

  it('stays inside the cold room: its walls, the open door and the low ceiling', () => {
    const start = createPlayerState(COOLER.minX + 1.5, -4, NORTH);
    const north = walk(start, { keys: Keys.Forward | Keys.Sprint, yaw: NORTH, pitch: 0 }, 2, true);
    expect(north.z).toBeCloseTo(COOLER.minZ + PLAYER_RADIUS, 3);
    const south = walk(north, { keys: Keys.Forward | Keys.Sprint, yaw: SOUTH, pitch: 0 }, 2, true);
    expect(south.z).toBeCloseTo(COOLER_DOOR.hingeZ - COOLER_DOOR.thickness - PLAYER_RADIUS, 3);
    let highest = 0;
    stepPlayer(south, { keys: Keys.Jump, yaw: SOUTH, pitch: 0 }, OPEN_COOLER_COLLIDERS);
    for (let i = 0; i < TICK_RATE; i++) {
      stepPlayer(south, { keys: 0, yaw: SOUTH, pitch: 0 }, OPEN_COOLER_COLLIDERS);
      highest = Math.max(highest, south.y);
    }
    expect(highest + PLAYER_HEIGHT).toBeCloseTo(COOLER.height, 3);
  });

  it('is the same on every machine: the same inputs and door give the same steps', () => {
    const inputs: PlayerInput[] = Array.from({ length: 360 }, (_, i) => ({
      keys: [Keys.Forward, Keys.Forward | Keys.Sprint, Keys.Forward | Keys.Jump][i % 3]!,
      yaw: EAST + Math.sin(i * 0.05) * 0.4,
      pitch: 0,
    }));
    const a = createPlayerState(6.5, DOOR_Z, EAST);
    const b = createPlayerState(6.5, DOOR_Z, EAST);
    // The door opens on the 120th input, for both.
    inputs.forEach((input, i) => stepPlayer(a, input, coolerColliders(i >= 120)));
    inputs.forEach((input, i) => {
      stepPlayer(b, { ...input }, coolerColliders(i >= 120));
      // As a snapshot would carry it over the wire.
      Object.assign(b, JSON.parse(JSON.stringify(b)));
    });
    expect(a).toEqual(b);
    expect(a.x).toBeGreaterThan(COOLER.minX);
  });

  it('has the shut door in the doorway, and the open one against the south wall', () => {
    const doorway = createPlayerState(ROOM_HALF_X + 0.1, DOOR_Z, EAST);
    expect(isInsideCollider(doorway, COLLIDERS)).toBe(true);
    expect(isInsideCollider(doorway, OPEN_COOLER_COLLIDERS)).toBe(false);
    expect(inPlayArea(doorway.x, doorway.z, false)).toBe(false);
    expect(inPlayArea(doorway.x, doorway.z, true)).toBe(true);
  });
});

describe('the door bursting', () => {
  it(`takes ${COOLER_HITS_TO_OPEN} hits`, () => {
    expect(coolerBurst(COOLER_HITS_TO_OPEN - 1)).toBe(false);
    expect(coolerBurst(COOLER_HITS_TO_OPEN)).toBe(true);
  });
});
