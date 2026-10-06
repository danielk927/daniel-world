import { describe, expect, it } from 'vitest';
import {
  EYE_HEIGHT,
  KNIFE_MAX_FLIGHT_SECONDS,
  Keys,
  SPAWN,
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
    const eye = { x: -6.6, y: EYE_HEIGHT, z: -2.6 };
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
});
