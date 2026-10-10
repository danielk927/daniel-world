import { describe, expect, it } from 'vitest';
import {
  COOLER,
  COOLER_HITS_TO_OPEN,
  DOORS,
  EYE_HEIGHT,
  KNIFE_MAX_FLIGHT_SECONDS,
  Keys,
  PLAY_HALF_X,
  PLAY_HALF_Z,
  PLAYER_RADIUS,
  PUNCH_COOLDOWN_INPUTS,
  ROOM_HALF_X,
  SPAWN,
  TICK_RATE,
  coolerColliders,
  createPlayerState,
  createRandom,
  flyKnife,
  isInsideCollider,
  launchKnife,
  parseServerMessage,
  wrapAngle,
  type ServerMessage,
} from '@world/shared';
import {
  CHEF_NAME,
  CHEF_SPAWN,
  ENTRANCE_LINES,
  ENTRANCE_TICKS,
  GRACE_TICKS,
  WAYPOINTS,
  WIND_UP_TICKS,
  WalkInChef,
  aimAt,
  type Chef,
} from './chef.ts';
import { Room, type RoomPlayer } from './room.ts';

const seconds = (s: number): number => Math.round(s * TICK_RATE);
const EAST = -Math.PI / 2;
/** Where a cook stands to punch the walk-in's door, facing it. */
const AT_THE_DOOR = { x: ROOM_HALF_X - 0.7, z: -3, yaw: EAST } as const;
/** He is only ever out with the walk-in open, so its doorway and cold room are his to walk. */
const OPEN = coolerColliders(true);

describe('the aisles Chef Skinner walks', () => {
  it("are clear of every fixture along every edge, the walk-in's shelves, door and doorway too", () => {
    for (const a of WAYPOINTS) {
      for (const n of a.next) {
        const b = WAYPOINTS[n]!;
        for (let t = 0; t <= 1; t += 0.02) {
          const state = createPlayerState(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
          expect(isInsideCollider(state, OPEN), `${a.x},${a.z} -> ${b.x},${b.z} at ${t}`).toBe(
            false,
          );
        }
      }
    }
  });

  it('join up, so he can get anywhere from anywhere, the cold room included', () => {
    const seen = new Set([0]);
    const queue = [0];
    while (queue.length > 0) {
      for (const n of WAYPOINTS[queue.pop()!]!.next) {
        if (seen.has(n)) continue;
        seen.add(n);
        queue.push(n);
      }
    }
    expect(seen.size).toBe(WAYPOINTS.length);
    expect(WAYPOINTS.some((w) => w.x > COOLER.minX + PLAYER_RADIUS)).toBe(true);
  });

  it('start where he does: at the back of the cold room, clear of its shelves, facing the doorway', () => {
    const start = createPlayerState(CHEF_SPAWN.x, CHEF_SPAWN.z, CHEF_SPAWN.yaw);
    expect(isInsideCollider(start, OPEN)).toBe(false);
    expect(CHEF_SPAWN.x).toBeGreaterThan((COOLER.minX + COOLER.maxX) / 2);
    const doorway = { x: ROOM_HALF_X, z: (DOORS.walkIn.from + DOORS.walkIn.to) / 2 };
    const toDoorway = Math.atan2(-(doorway.x - CHEF_SPAWN.x), -(doorway.z - CHEF_SPAWN.z));
    expect(Math.abs(wrapAngle(CHEF_SPAWN.yaw - toDoorway))).toBeLessThan(0.01);
  });
});

describe('his aim', () => {
  it('hits a cook standing in the open', () => {
    const eye = { x: 0, y: EYE_HEIGHT, z: -5.3 };
    for (const [x, z] of [
      [0, -2.6],
      [-6.6, 2.6],
      [6.3, 5.3],
    ] as const) {
      const target = { x, y: 0, z, vx: 0, vz: 0 };
      const aim = aimAt(eye, target, 1, 2);
      expect(aim, `${x},${z}`).not.toBeNull();
      const knife = launchKnife(eye.x, eye.y, eye.z, aim!.yaw, aim!.pitch);
      const impact = flyKnife(knife, KNIFE_MAX_FLIGHT_SECONDS, [{ id: 2, ...target }], 1);
      expect(impact?.kind).toBe('player');
    }
  });

  it('leads a cook running across, who a straight throw would miss', () => {
    // From the dining room side, over the pass. (Across the piano, a throw that leads a runner
    // arcs up into the high shelf down its spine.)
    const eye = { x: 0, y: EYE_HEIGHT, z: 5.6 };
    const fly = (lead: boolean): string | undefined => {
      const target = { x: 0, y: 0, z: 2.6, vx: 5, vz: 0 };
      const aim = aimAt(eye, lead ? target : { ...target, vx: 0 }, 1, 2)!;
      const knife = launchKnife(eye.x, eye.y, eye.z, aim.yaw, aim.pitch);
      for (let t = 0; t < KNIFE_MAX_FLIGHT_SECONDS; t += 0.01) {
        const impact = flyKnife(knife, 0.01, [{ id: 2, ...target }], 1);
        if (impact) return impact.kind;
        target.x += target.vx * 0.01;
      }
      return undefined;
    };
    expect(fly(true)).toBe('player');
    expect(fly(false)).not.toBe('player');
  });

  it('reaches through the open doorway, into the cold room and out of it', () => {
    const inside = { x: CHEF_SPAWN.x, y: 0, z: CHEF_SPAWN.z, vx: 0, vz: 0 };
    const outside = { x: AT_THE_DOOR.x - 2, y: 0, z: AT_THE_DOOR.z, vx: 0, vz: 0 };
    const eye = (at: { x: number; z: number }) => ({ x: at.x, y: EYE_HEIGHT, z: at.z });
    expect(aimAt(eye(outside), inside, 1, 2)).not.toBeNull();
    expect(aimAt(eye(inside), outside, 1, 2)).not.toBeNull();
  });
});

/** Back and forth along the aisle by the dining room doors, knife in hand. */
const pacing = (tick: number): number =>
  (Math.floor(tick / 30) % 2 === 0 ? Keys.Left : Keys.Right) | Keys.Armed;
/** Standing still, knife in hand. */
const still = (): number => Keys.Armed;

interface CookPlan {
  /** Where along the aisle by the dining room doors they start. */
  readonly x?: number;
  /** Whether Chef Skinner throws at them. */
  readonly chef?: boolean;
  readonly keys: (tick: number) => number;
}

/**
 * A room with Chef Skinner locked in its walk-in and the given cooks in it, stepped as the server
 * steps a room: his think, then the room's step, every tick.
 */
function kitchen(plans: readonly CookPlan[], seed = 7) {
  const room = new Room('lobby');
  const heard: ServerMessage[] = [];
  let nextId = 1;
  const walkIn = new WalkInChef(room, () => nextId++, createRandom(seed));
  const cooks = plans.map((plan, i) => ({
    player: room.add({
      id: nextId++,
      name: `Cook ${i + 1}`,
      spawn: { ...SPAWN, x: plan.x ?? SPAWN.x },
      prefs: { chef: plan.chef ?? true },
      // Everyone hears the same; the first cook's ears will do.
      send: i === 0 ? (data) => heard.push(parseServerMessage(data)!) : () => {},
    }),
    keys: plan.keys,
    seq: 0,
  }));
  /** A cook punching the walk-in's door, while one is. */
  let boxer: { player: RoomPlayer; seq: number } | null = null;
  /** The tick of the think he came out in, once he has. */
  let appearedAt: number | null = null;
  /** Whom he wound up on, and the tick of the think he picked them in. */
  const picks: { id: number; tick: number }[] = [];
  /** Where he was after every tick since he came out. */
  const track: { x: number; z: number }[] = [];

  const step = (): void => {
    for (const cook of cooks) {
      if (!room.players.has(cook.player.id)) continue;
      const keys = cook.keys(room.tick);
      room.enqueueInput(cook.player, { seq: cook.seq++, keys, yaw: 0, pitch: 0 });
    }
    if (boxer) {
      // Bare-handed, a punch as soon as the last one has cooled down.
      const keys = boxer.seq % PUNCH_COOLDOWN_INPUTS === 0 ? Keys.Punch : 0;
      room.enqueueInput(boxer.player, { seq: boxer.seq++, keys, yaw: EAST, pitch: 0 });
    }
    const was = walkIn.chef?.target ?? null;
    walkIn.think();
    const chef = walkIn.chef;
    if (chef && appearedAt === null) appearedAt = room.tick;
    if (chef && chef.target !== null && chef.target !== was) {
      picks.push({ id: chef.target, tick: room.tick });
    }
    room.step();
    if (chef) track[room.tick] = { x: chef.player.state.x, z: chef.player.state.z };
  };
  const steps = (n: number): void => {
    for (let i = 0; i < n; i++) step();
  };
  /** A cook at the walk-in punches its door until it has taken `hits`, then goes. */
  const punch = (hits: number): void => {
    const player = room.add({ id: nextId++, name: 'Boxer', spawn: AT_THE_DOOR, send: () => {} });
    boxer = { player, seq: 0 };
    while (room.cooler.hits < hits) step();
    boxer = null;
    room.remove(player.id);
  };
  /** Burst the walk-in's door; the tick it burst on. */
  const burst = (): number => {
    punch(COOLER_HITS_TO_OPEN);
    expect(room.cooler.burst).toBe(true);
    return room.tick;
  };
  /** Burst the door and step on until he is out. */
  const letOut = (): Chef => {
    burst();
    while (!walkIn.chef) step();
    return walkIn.chef;
  };
  const chefId = (): number | undefined => walkIn.chef?.player.id;
  const fromChef = <T extends 'knife' | 'kill' | 'chat'>(t: T) =>
    heard.filter(
      (m): m is Extract<ServerMessage, { t: T }> =>
        m.t === t && (m.t === 'chat' ? m.id : m.from) === chefId(),
    );
  const residents = (): RoomPlayer[] => [...room.players.values()].filter((p) => p.resident);
  return {
    room,
    walkIn,
    cooks: cooks.map((c) => c.player),
    heard,
    picks,
    track,
    get appearedAt() {
      return appearedAt;
    },
    step,
    steps,
    punch,
    burst,
    letOut,
    fromChef,
    residents,
  };
}

describe('Chef Skinner, locked in the walk-in', () => {
  it('is nowhere while its door holds, however long the room is open and however hard it is hit', () => {
    const k = kitchen([{ keys: pacing }]);
    k.steps(seconds(30));
    k.punch(COOLER_HITS_TO_OPEN - 1);
    k.steps(seconds(30));
    expect(k.walkIn.chef).toBeNull();
    expect(k.residents()).toEqual([]);
    const heardOf = k.heard.filter((m) => m.t === 'join' || m.t === 'chat');
    expect(heardOf.map((m) => (m.t === 'join' ? m.player.name : m.t))).toEqual(['Boxer']);
  });

  it(`comes out ${ENTRANCE_TICKS} ticks after the tenth hit, not a tick before, at the back of the cold room, shouting`, () => {
    const k = kitchen([{ keys: still }]);
    const burstAt = k.burst();
    while (k.room.tick < burstAt + ENTRANCE_TICKS - 1) {
      k.step();
      expect(k.walkIn.chef).toBeNull();
      expect(k.residents()).toEqual([]);
    }
    k.step();
    expect(k.room.tick).toBe(burstAt + ENTRANCE_TICKS);
    const chef = k.walkIn.chef!;
    expect(chef.player.name).toBe(CHEF_NAME);
    expect(k.residents()).toEqual([chef.player]);
    // At the back of the cold room, the doorway open to him from his first input on.
    expect(chef.player.state.x).toBeGreaterThan(COOLER.minX + 2);
    expect(chef.player.coolerFrom).toBe(0);
    // Everyone heard him come in, and what he had to say about it.
    const join = k.heard.find((m) => m.t === 'join' && m.player.id === chef.player.id);
    expect(join).toMatchObject({ player: { name: CHEF_NAME, resident: true } });
    const said = k.fromChef('chat');
    expect(said).toHaveLength(1);
    expect(ENTRANCE_LINES).toContain(said[0]!.text);
  });

  it('stands his ground a moment, then walks out through the doorway into the kitchen', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const k = kitchen([{ keys: still }], seed);
      const chef = k.letOut();
      const start = { x: chef.player.state.x, z: chef.player.state.z };
      k.steps(seconds(0.8));
      expect(chef.player.state.x, `seed ${seed}`).toBeCloseTo(start.x, 6);
      expect(chef.player.state.z, `seed ${seed}`).toBeCloseTo(start.z, 6);
      let out = false;
      for (let i = 0; i < seconds(6) && !out; i++) {
        k.step();
        expect(isInsideCollider(chef.player.state, OPEN)).toBe(false);
        out = chef.player.state.x < ROOM_HALF_X - PLAYER_RADIUS;
      }
      expect(out, `seed ${seed}: out in the kitchen within seconds`).toBe(true);
    }
  });

  it('leaves everyone alone for 8 s from when he appears, however long they have been about', () => {
    const k = kitchen([
      { x: -2, keys: pacing },
      { x: 2, keys: pacing },
    ]);
    // Long past a newcomer's grace, and on the move all the while.
    k.steps(seconds(30));
    k.letOut();
    k.steps(GRACE_TICKS + seconds(60));
    expect(k.picks.length, 'he does go for them in the end').toBeGreaterThan(0);
    for (const pick of k.picks)
      expect(pick.tick - k.appearedAt!).toBeGreaterThanOrEqual(GRACE_TICKS);
  });

  it('is never let out of a room that empties before his second is up', () => {
    const k = kitchen([{ keys: still }]);
    k.burst();
    k.steps(ENTRANCE_TICKS / 2);
    for (const cook of k.cooks) k.room.remove(cook.id);
    k.steps(ENTRANCE_TICKS * 2);
    expect(k.walkIn.chef).toBeNull();
    expect(k.room.players.size).toBe(0);
  });

  it('can be knocked out where he stands, and gets back up in the kitchen', () => {
    const k = kitchen([{ keys: still }]);
    const chef = k.letOut();
    // A cook in the doorway throws at him as he stands at the back, shouting.
    const thrower = k.room.add({ id: 500, name: 'Thrower', spawn: AT_THE_DOOR, send: () => {} });
    const s = thrower.state;
    const eye = { x: s.x, y: s.y + EYE_HEIGHT, z: s.z };
    const aim = aimAt(eye, chef.player.state, thrower.id, chef.player.id)!;
    expect(aim).not.toBeNull();
    let seq = 0;
    const tick = (keys: number): void => {
      k.room.enqueueInput(thrower, { seq: seq++, keys: keys | Keys.Armed, ...aim });
      k.step();
    };
    tick(Keys.Throw);
    for (let i = 0; i < seconds(0.5) && chef.player.deadUntil === null; i++) tick(0);
    expect(k.fromChef('kill')).toEqual([]);
    expect(chef.player.deadUntil).not.toBeNull();
    while (chef.player.deadUntil !== null) tick(0);
    // Up again in the kitchen, and on his way.
    const up = { x: chef.player.state.x, z: chef.player.state.z };
    expect(Math.abs(up.x)).toBeLessThanOrEqual(PLAY_HALF_X);
    expect(Math.abs(up.z)).toBeLessThanOrEqual(PLAY_HALF_Z);
    for (let i = 0; i < seconds(3); i++) tick(0);
    expect(Math.hypot(chef.player.state.x - up.x, chef.player.state.z - up.z)).toBeGreaterThan(1);
  });
});

describe('Chef Skinner, once out', () => {
  it('joins the room as a resident cook, and does not keep it open on his own', () => {
    const k = kitchen([{ keys: still }]);
    const chef = k.letOut();
    expect(chef.player.resident).toBe(true);
    expect(k.room.visitors).toBe(1);
    k.room.remove(k.cooks[0]!.id);
    expect(k.room.isEmpty).toBe(true);
  });

  it('walks the whole kitchen, and back into the cold room, without ever ending up inside anything', () => {
    const k = kitchen([{ keys: still }]);
    k.letOut();
    k.steps(seconds(180));
    const visited = new Set<number>();
    let wentOut = false;
    let cameBack = false;
    for (const at of k.track.filter(Boolean)) {
      expect(isInsideCollider(createPlayerState(at.x, at.z), OPEN)).toBe(false);
      WAYPOINTS.forEach((w, i) => {
        if (Math.hypot(w.x - at.x, w.z - at.z) < 0.5) visited.add(i);
      });
      if (at.x < 0) wentOut = true;
      if (wentOut && at.x > COOLER.minX + 1) cameBack = true;
    }
    expect(visited.size).toBeGreaterThan(WAYPOINTS.length / 2);
    expect(cameBack, 'he wanders back into the cold room now and then').toBe(true);
  });

  it('leaves a cook standing still alone: they are reading', () => {
    const k = kitchen([{ keys: still }]);
    k.letOut();
    k.steps(seconds(90));
    expect(k.fromChef('knife')).toEqual([]);
    expect(k.picks).toEqual([]);
  });

  it('throws at a cook on the move, after their grace, from a standstill he holds first', () => {
    const k = kitchen([{ keys: pacing }]);
    k.letOut();
    k.steps(seconds(120));
    const knives = k.fromChef('knife');
    expect(knives.length).toBeGreaterThan(3);
    // Which tick each knife left on: the snapshot broadcast right after it.
    let tick = 0;
    const thrownAt: number[] = [];
    for (const m of k.heard) {
      if (m.t === 'snap') tick = m.tick;
      if (m.t === 'knife' && m.from === k.walkIn.chef!.player.id) thrownAt.push(tick + 1);
    }
    for (const t of thrownAt) {
      expect(t).toBeGreaterThan(k.appearedAt! + GRACE_TICKS);
      // He stood his ground for the wind-up, so the cook could see it coming.
      const start = k.track[t - WIND_UP_TICKS + 2]!;
      const end = k.track[t]!;
      expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeLessThan(0.3);
    }
    // And some of them land.
    expect(k.fromChef('kill').some((m) => m.to === k.cooks[0]!.id)).toBe(true);
  });

  it('walks on when he loses his shot, never standing in one spot past a pause and a wind-up', () => {
    // A cook pacing out of sight now and then, each time they turn: seed 8 once had him wind up
    // again on the tick he lost them, so he stood winding up for good and never threw.
    for (let seed = 1; seed <= 10; seed++) {
      const k = kitchen([{ keys: pacing }], seed);
      k.letOut();
      const from = k.room.tick;
      k.steps(seconds(120));
      let longest = 0;
      let since = from;
      for (let t = from + 1; t <= k.room.tick; t++) {
        const [a, b] = [k.track[since]!, k.track[t]!];
        if (Math.hypot(b.x - a.x, b.z - a.z) > 0.3) since = t;
        longest = Math.max(longest, t - since);
      }
      expect(longest / TICK_RATE, `seed ${seed}: longest standstill, in seconds`).toBeLessThan(5);
      expect(k.fromChef('knife').length, `seed ${seed}`).toBeGreaterThan(2);
    }
  });

  it('has something to say when he knocks someone out', () => {
    const k = kitchen([{ keys: pacing }]);
    k.letOut();
    k.steps(seconds(120));
    const lines = k.fromChef('chat').map((m) => m.text);
    expect(lines.filter((line) => !ENTRANCE_LINES.includes(line)).length).toBeGreaterThan(0);
  });
});

describe('Chef Skinner, for a cook who has turned him off', () => {
  it('never picks them, however much they move, and has nothing to say to them', () => {
    const k = kitchen([{ x: 0, chef: false, keys: pacing }]);
    k.letOut();
    k.steps(seconds(120));
    expect(k.picks).toEqual([]);
    expect(k.fromChef('knife')).toEqual([]);
    // Only what he shouted coming out of the walk-in.
    expect(k.fromChef('chat')).toHaveLength(1);
  });

  it('still throws at everyone else, and his knives pass through them on the way', () => {
    const k = kitchen([
      { x: 0, chef: false, keys: pacing },
      { x: 3.5, chef: true, keys: pacing },
    ]);
    const [off, on] = k.cooks as [RoomPlayer, RoomPlayer];
    k.letOut();
    k.steps(seconds(120));
    expect(new Set(k.picks.map((p) => p.id))).toEqual(new Set([on.id]));
    expect(k.fromChef('knife').length).toBeGreaterThan(3);
    const kills = k.fromChef('kill');
    expect(kills.length).toBeGreaterThan(0);
    expect(kills.every((m) => m.to === on.id)).toBe(true);
    expect(off.deadUntil).toBeNull();
  });

  it('gives up on them mid wind-up, the moment they turn him off', () => {
    const k = kitchen([{ x: 0, chef: true, keys: pacing }]);
    const [cook] = k.cooks as [RoomPlayer];
    const chef = k.letOut();
    for (let i = 0; i < seconds(120) && chef.target === null; i++) k.step();
    expect(chef.target).toBe(cook.id);
    const thrown = k.fromChef('knife').length;
    cook.prefs = { chef: false };
    k.step();
    expect(chef.target).toBeNull();
    // Long past when the knife would have left his hand, and he has not picked them again.
    k.steps(WIND_UP_TICKS + seconds(30));
    expect(k.fromChef('knife').length).toBe(thrown);
    expect(new Set(k.picks.map((p) => p.id))).toEqual(new Set([cook.id]));
  });
});
