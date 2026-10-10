import { describe, expect, it } from 'vitest';
import {
  EYE_HEIGHT,
  KNIFE_MAX_FLIGHT_SECONDS,
  Keys,
  SPAWN,
  TICK_RATE,
  createPlayerState,
  createRandom,
  flyKnife,
  isInsideCollider,
  launchKnife,
  parseServerMessage,
  type ServerMessage,
} from '@world/shared';
import { CHEF_NAME, Chef, GRACE_TICKS, WAYPOINTS, WIND_UP_TICKS, aimAt } from './chef.ts';
import { Room, type RoomPlayer } from './room.ts';

describe('the aisles Chef Skinner walks', () => {
  it('are clear of every fixture along every edge', () => {
    for (const a of WAYPOINTS) {
      for (const n of a.next) {
        const b = WAYPOINTS[n]!;
        for (let t = 0; t <= 1; t += 0.02) {
          const state = createPlayerState(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t);
          expect(isInsideCollider(state), `${a.x},${a.z} -> ${b.x},${b.z} at ${t}`).toBe(false);
        }
      }
    }
  });

  it('join up, so he can get anywhere from anywhere', () => {
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
});

interface Run {
  room: Room;
  chef: Chef;
  cook: RoomPlayer;
  messages: ServerMessage[];
  /** The chef's position at every tick. */
  track: { x: number; z: number }[];
}

/** A lobby with Chef Skinner and one cook, who walks (or not) as `walk` says, for `ticks` ticks. */
function run(ticks: number, walk: (tick: number) => number, seed = 7): Run {
  const room = new Room('lobby');
  const messages: ServerMessage[] = [];
  const chef = new Chef(room, 1, createRandom(seed));
  room.onKnockout = (from, to) => {
    if (from === chef.player.id) chef.onKnockout(to);
  };
  const cook = room.add({
    id: 2,
    name: 'Cook',
    spawn: SPAWN,
    send: (data) => messages.push(parseServerMessage(data)!),
  });
  const track: { x: number; z: number }[] = [];
  let seq = 0;
  for (let i = 0; i < ticks; i++) {
    room.enqueueInput(cook, { seq: seq++, keys: walk(room.tick) | Keys.Armed, yaw: 0, pitch: 0 });
    chef.think();
    room.step();
    track[room.tick] = { x: chef.player.state.x, z: chef.player.state.z };
  }
  return { room, chef, cook, messages, track };
}

/** Back and forth along the aisle by the dining room doors. */
const pacing = (tick: number): number => (Math.floor(tick / 30) % 2 === 0 ? Keys.Left : Keys.Right);

const knivesFromChef = (r: Run) =>
  r.messages.flatMap((m) => (m.t === 'knife' && m.from === r.chef.player.id ? [m] : []));

describe('Chef Skinner', () => {
  it('joins the room as a resident cook, and does not keep it open on his own', () => {
    const room = new Room('lobby');
    const chef = new Chef(room, 1, createRandom(1));
    expect(chef.player.name).toBe(CHEF_NAME);
    expect(chef.player.resident).toBe(true);
    expect(room.visitors).toBe(0);
    expect(room.isEmpty).toBe(true);
  });

  it('walks the whole kitchen without ever ending up inside a counter', () => {
    const r = run(20 * 120, () => 0);
    const visited = new Set<number>();
    for (const at of r.track.slice(1)) {
      const state = createPlayerState(at.x, at.z);
      expect(isInsideCollider(state)).toBe(false);
      WAYPOINTS.forEach((w, i) => {
        if (Math.hypot(w.x - at.x, w.z - at.z) < 0.5) visited.add(i);
      });
    }
    expect(visited.size).toBeGreaterThan(WAYPOINTS.length / 2);
  });

  it('leaves a cook standing still alone: they are reading', () => {
    expect(knivesFromChef(run(20 * 90, () => 0))).toEqual([]);
  });

  it('throws at a cook on the move, after their grace, from a standstill he holds first', () => {
    const r = run(20 * 120, pacing);
    const knives = knivesFromChef(r);
    expect(knives.length).toBeGreaterThan(3);
    // Which tick each knife left on: the snapshot broadcast right after it.
    let tick = 0;
    const thrownAt: number[] = [];
    for (const m of r.messages) {
      if (m.t === 'snap') tick = m.tick;
      if (m.t === 'knife' && m.from === r.chef.player.id) thrownAt.push(tick + 1);
    }
    for (const t of thrownAt) {
      expect(t).toBeGreaterThan(GRACE_TICKS);
      // He stood his ground for the wind-up, so the cook could see it coming.
      const start = r.track[t - WIND_UP_TICKS + 2]!;
      const end = r.track[t]!;
      expect(Math.hypot(end.x - start.x, end.z - start.z)).toBeLessThan(0.3);
    }
    // And some of them land.
    expect(r.messages.some((m) => m.t === 'kill' && m.to === r.cook.id)).toBe(true);
  });

  it('has something to say when he knocks someone out', () => {
    const r = run(20 * 120, pacing);
    const lines = r.messages.filter((m) => m.t === 'chat' && m.id === r.chef.player.id);
    expect(lines.length).toBeGreaterThan(0);
  });

  it('walks on when he loses his shot, never standing in one spot past a pause and a wind-up', () => {
    // A cook pacing out of sight now and then, each time they turn: picking them again on the tick
    // he lost them had him wind up afresh, again and again, standing there for good, never throwing.
    for (let seed = 1; seed <= 10; seed++) {
      const r = run(TICK_RATE * 120, pacing, seed);
      let longest = 0;
      let since = 1;
      for (let t = 2; t < r.track.length; t++) {
        const [a, b] = [r.track[since]!, r.track[t]!];
        if (Math.hypot(b.x - a.x, b.z - a.z) > 0.3) since = t;
        longest = Math.max(longest, t - since);
      }
      expect(longest / TICK_RATE, `seed ${seed}: longest standstill, in seconds`).toBeLessThan(5);
      expect(knivesFromChef(r).length, `seed ${seed}`).toBeGreaterThan(2);
    }
  });
});

interface Cook {
  readonly player: RoomPlayer;
  readonly walk: (tick: number) => number;
  seq: number;
}

/** A lobby with Chef Skinner and the given cooks, stepped tick by tick. */
function lobby(cooks: { x: number; chef: boolean; walk: (tick: number) => number }[], seed = 7) {
  const room = new Room('lobby');
  const messages: ServerMessage[] = [];
  const chef = new Chef(room, 1, createRandom(seed));
  room.onKnockout = (from, to) => {
    if (from === chef.player.id) chef.onKnockout(to);
  };
  const joined: Cook[] = cooks.map((c, i) => ({
    player: room.add({
      id: i + 2,
      name: `Cook ${i + 1}`,
      spawn: { ...SPAWN, x: c.x },
      prefs: { chef: c.chef },
      // Everyone hears the same; the first cook's ears will do.
      send: i === 0 ? (data) => messages.push(parseServerMessage(data)!) : () => {},
    }),
    walk: c.walk,
    seq: 0,
  }));
  /** Whom he wound up on, over every tick so far. */
  const targets = new Set<number>();
  const step = (): void => {
    for (const cook of joined) {
      const keys = cook.walk(room.tick) | Keys.Armed;
      room.enqueueInput(cook.player, { seq: cook.seq++, keys, yaw: 0, pitch: 0 });
    }
    chef.think();
    if (chef.target !== null) targets.add(chef.target);
    room.step();
  };
  const steps = (n: number): void => {
    for (let i = 0; i < n; i++) step();
  };
  const fromChef = <T extends 'knife' | 'kill' | 'chat'>(t: T) =>
    messages.filter(
      (m): m is Extract<ServerMessage, { t: T }> =>
        m.t === t && (m.t === 'chat' ? m.id : m.from) === chef.player.id,
    );
  const players = joined.map((c) => c.player);
  return { room, chef, cooks: players, messages, targets, step, steps, fromChef };
}

describe('Chef Skinner, for a cook who has turned him off', () => {
  const seconds = (s: number) => Math.round(s * TICK_RATE);

  it('never picks them, however much they move, and has nothing to say to them', () => {
    const l = lobby([{ x: 0, chef: false, walk: pacing }]);
    l.steps(seconds(120));
    expect(l.targets.size).toBe(0);
    expect(l.fromChef('knife')).toEqual([]);
    expect(l.fromChef('chat')).toEqual([]);
  });

  it('still throws at everyone else, and his knives pass through them on the way', () => {
    const l = lobby([
      { x: 0, chef: false, walk: pacing },
      { x: 3.5, chef: true, walk: pacing },
    ]);
    const [off, on] = l.cooks as [RoomPlayer, RoomPlayer];
    l.steps(seconds(120));
    expect([...l.targets]).toEqual([on.id]);
    expect(l.fromChef('knife').length).toBeGreaterThan(3);
    const kills = l.fromChef('kill');
    expect(kills.length).toBeGreaterThan(0);
    expect(kills.every((k) => k.to === on.id)).toBe(true);
    expect(off.deadUntil).toBeNull();
  });

  it('gives up on them mid wind-up, the moment they turn him off', () => {
    const l = lobby([{ x: 0, chef: true, walk: pacing }]);
    const [cook] = l.cooks as [RoomPlayer];
    for (let i = 0; i < seconds(120) && l.chef.target === null; i++) l.step();
    expect(l.chef.target).toBe(cook.id);
    const thrown = l.fromChef('knife').length;
    cook.prefs = { chef: false };
    l.step();
    expect(l.chef.target).toBeNull();
    // Long past when the knife would have left his hand, and he has not picked them again.
    l.steps(WIND_UP_TICKS + seconds(30));
    expect(l.fromChef('knife').length).toBe(thrown);
    expect(l.targets).toEqual(new Set([cook.id]));
  });
});
