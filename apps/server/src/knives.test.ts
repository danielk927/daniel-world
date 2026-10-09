import { describe, expect, it } from 'vitest';
import {
  EYE_HEIGHT,
  KNIFE_COOLDOWN_INPUTS,
  KNIFE_MAX_STUCK,
  Keys,
  parseServerMessage,
  thrownKnife,
  type ServerMessage,
  TICK_RATE,
} from '@world/shared';
import { MAX_REWIND_TICKS } from './knives.ts';
import { DEATH_TICKS, PROTECTION_TICKS, Room, type RoomPlayer } from './room.ts';

/** Yaw that looks along -Z (north), the way the spawn faces. */
const NORTH = 0;

function setup() {
  const room = new Room('knives');
  const inboxes = new Map<number, ServerMessage[]>();
  let nextId = 1;
  const join = (x: number, z: number, options: { resident?: boolean } = {}): RoomPlayer => {
    const id = nextId++;
    const inbox: ServerMessage[] = [];
    inboxes.set(id, inbox);
    const player = room.add({
      id,
      name: `P${id}`,
      spawn: { x, z, yaw: NORTH },
      resident: options.resident ?? false,
      send: (data) => {
        const message = parseServerMessage(data);
        if (message && message.t !== 'snap') inbox.push(message);
      },
    });
    return player;
  };
  const seqs = new Map<number, number>();
  /** Queue one input for a player, throwing a knife if asked. */
  const input = (
    player: RoomPlayer,
    options: {
      throwKnife?: boolean;
      keys?: number;
      yaw?: number;
      pitch?: number;
      view?: number;
      bareHand?: boolean;
    },
  ): void => {
    const seq = seqs.get(player.id) ?? 0;
    seqs.set(player.id, seq + 1);
    room.enqueueInput(player, {
      seq,
      keys:
        (options.keys ?? 0) |
        (options.throwKnife ? Keys.Throw : 0) |
        (options.bareHand ? 0 : Keys.Armed),
      yaw: options.yaw ?? NORTH,
      pitch: options.pitch ?? 0,
      view: options.view,
    });
  };
  const steps = (n: number): void => {
    for (let i = 0; i < n; i++) room.step();
  };
  const received = <T extends ServerMessage['t']>(id: number, t: T) =>
    inboxes.get(id)!.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
  return { room, join, input, steps, received };
}

/** Long enough for any knife in these tests to land. */
const FLIGHT = Math.round(0.25 * TICK_RATE);

describe('knives', () => {
  it('tells everyone about a throw, with the input that threw it', () => {
    const { join, input, steps, received } = setup();
    const a = join(0, 5.6);
    const b = join(-5, 5.6);
    input(a, { throwKnife: true });
    steps(1);
    for (const id of [a.id, b.id]) {
      const [knife] = received(id, 'knife');
      expect(knife).toMatchObject({ from: a.id, seq: 0 });
      expect(knife!.vz).toBeLessThan(-10);
    }
  });

  it("spreads every knife by who threw it and on which input, as the thrower's screen does", () => {
    const { join, input, steps, received } = setup();
    const a = join(0, 5.6);
    const b = join(-3, 5.6);
    const chef = join(3, 5.6, { resident: true });
    const cooks = [a, b, chef];
    // The same aim, on the same input, from three cooks (Chef Skinner among them).
    for (const cook of cooks) input(cook, { throwKnife: true, pitch: 0.05 });
    steps(1);
    const knives = received(a.id, 'knife');
    expect(knives.map((k) => k.from)).toEqual(cooks.map((c) => c.id));
    for (const knife of knives) {
      // The thrower's screen launches its own knife from the eye after the same step, by its id
      // in the room and the input's sequence number.
      const s = cooks.find((c) => c.id === knife.from)!.state;
      const own = thrownKnife(s.x, s.y + EYE_HEIGHT, s.z, NORTH, 0.05, knife.from, knife.seq);
      expect([knife.x, knife.y, knife.z, knife.vx, knife.vy, knife.vz]).toEqual([
        own.x,
        own.y,
        own.z,
        own.vx,
        own.vy,
        own.vz,
      ]);
    }
    // Three ways, none of them exactly where they looked.
    const headings = new Set(knives.map((k) => Math.atan2(k.vx, -k.vz)));
    expect(headings.size).toBe(3);
    expect(headings.has(0)).toBe(false);
  });

  it('knocks out a player it hits, who respawns protected after a while', () => {
    const { room, join, input, steps, received } = setup();
    const thrower = join(0, 5.6);
    const victim = join(0, 3.2);
    // Aim a little down so the knife meets the victim's chest, not their toque.
    input(thrower, { throwKnife: true, pitch: -0.1 });
    steps(FLIGHT);
    const [kill] = received(victim.id, 'kill');
    expect(kill).toMatchObject({ from: thrower.id, to: victim.id });
    expect(received(thrower.id, 'kill')).toHaveLength(1);
    expect(room.snapshotOf(victim).dead).toBe(true);

    // Knocked out: they cannot throw.
    input(victim, { throwKnife: true });
    steps(1);
    expect(received(thrower.id, 'knife')).toHaveLength(1);

    steps(DEATH_TICKS);
    const [respawn] = received(thrower.id, 'respawn');
    expect(respawn?.player).toMatchObject({ id: victim.id, dead: false });
    expect(room.snapshotOf(victim).dead).toBe(false);

    // Protected for a moment: a knife flies straight through.
    const s = victim.state;
    Object.assign(s, { x: 0, z: 3.2, vx: 0, vz: 0 });
    for (let i = 0; i < KNIFE_COOLDOWN_INPUTS; i++) input(thrower, {});
    input(thrower, { throwKnife: true, pitch: -0.1 });
    steps(KNIFE_COOLDOWN_INPUTS + FLIGHT);
    expect(received(thrower.id, 'knife')).toHaveLength(2);
    expect(received(thrower.id, 'kill')).toHaveLength(1);
    expect(PROTECTION_TICKS).toBeGreaterThan(KNIFE_COOLDOWN_INPUTS);
  });

  it('knocks a cook out once when two knives hit them on the same tick, and the other flies on', () => {
    const { join, input, steps, received } = setup();
    const left = join(-0.6, 5.6);
    const right = join(0.6, 5.6);
    const victim = join(0, 3.2);
    // Thrown together from either side, the same distance away: they arrive on the same tick.
    for (const thrower of [left, right]) {
      const yaw = Math.atan2(thrower.state.x - victim.state.x, thrower.state.z - victim.state.z);
      input(thrower, { throwKnife: true, yaw, pitch: -0.1 });
    }
    steps(FLIGHT);
    const knives = received(victim.id, 'knife');
    expect(knives.map((k) => k.from)).toEqual([left.id, right.id]);
    const kills = received(victim.id, 'kill');
    const stuck = received(victim.id, 'stuck');
    expect(kills).toMatchObject([{ knife: knives[0]!.id, from: left.id, to: victim.id }]);
    // Every knife ends somewhere: the second went on through and stuck past them.
    expect(stuck.map((m) => m.knife.id)).toEqual([knives[1]!.id]);
    expect(stuck[0]!.knife.z).toBeLessThan(victim.state.z);
    expect(stuck[0]!.at).toBeGreaterThan(kills[0]!.at);
  });

  it("passes a resident's knives through a cook who has turned him off, and nobody else's", () => {
    const { join, input, steps, received } = setup();
    const chef = join(0, 5.6, { resident: true });
    const visitor = join(2, 5.6);
    const cook = join(0, 3.2);
    cook.prefs = { chef: false };
    const throwFrom = (thrower: RoomPlayer): void => {
      const yaw = Math.atan2(thrower.state.x - cook.state.x, thrower.state.z - cook.state.z);
      for (let i = 0; i < KNIFE_COOLDOWN_INPUTS; i++) input(thrower, { yaw });
      input(thrower, { throwKnife: true, yaw, pitch: -0.1 });
      steps(KNIFE_COOLDOWN_INPUTS + 1 + FLIGHT);
    };
    throwFrom(chef);
    expect(received(cook.id, 'kill')).toHaveLength(0);
    // It flew on, through them, and landed somewhere in the kitchen.
    expect(received(cook.id, 'stuck')).toHaveLength(1);
    // Turning him off is about him: another visitor's knife still lands.
    throwFrom(visitor);
    expect(received(cook.id, 'kill')).toMatchObject([{ from: visitor.id, to: cook.id }]);
    steps(DEATH_TICKS + PROTECTION_TICKS);
    // And it applies at once: back on, his next knife lands too.
    Object.assign(cook.state, { x: 0, z: 3.2, vx: 0, vz: 0 });
    cook.prefs = { chef: true };
    throwFrom(chef);
    expect(received(cook.id, 'kill').map((k) => k.from)).toEqual([visitor.id, chef.id]);
  });

  it('passes the knives of a cook who has turned him off through the resident too', () => {
    const { join, input, steps, received } = setup();
    const cook = join(0, 5.6);
    const chef = join(0, 3.2, { resident: true });
    cook.prefs = { chef: false };
    input(cook, { throwKnife: true, pitch: -0.1 });
    steps(FLIGHT);
    expect(received(cook.id, 'kill')).toHaveLength(0);
    expect(received(cook.id, 'stuck')).toHaveLength(1);
    expect(chef.deadUntil).toBeNull();
  });

  it('sticks knives where they land and keeps only the newest for newcomers', () => {
    const { room, join, input, steps, received } = setup();
    const a = join(0, 2.6);
    // Straight down into the aisle floor.
    input(a, { throwKnife: true, pitch: -Math.PI / 2 + 0.01 });
    steps(FLIGHT);
    const [stuck] = received(a.id, 'stuck');
    expect(stuck!.knife.y).toBeLessThan(0);
    expect(stuck!.knife.dy).toBeLessThan(-0.99);
    expect(room.stuckKnives().map((k) => k.id)).toEqual([stuck!.knife.id]);

    // One input per tick, as a client sends them, throwing whenever the cooldown allows.
    for (let i = 0; i < KNIFE_MAX_STUCK + 5; i++) {
      for (let k = 0; k < KNIFE_COOLDOWN_INPUTS - 1; k++) {
        input(a, {});
        steps(1);
      }
      input(a, { throwKnife: true, pitch: -Math.PI / 2 + 0.01 });
      steps(1);
    }
    steps(FLIGHT);
    const knives = room.stuckKnives();
    expect(knives).toHaveLength(KNIFE_MAX_STUCK);
    // Oldest first, and the oldest few were dropped.
    expect(knives[0]!.id).toBe(6);
    expect(knives.at(-1)!.id).toBe(KNIFE_MAX_STUCK + 5);
  });

  it('cannot throw with a bare hand, and shows everyone whether a knife is out', () => {
    const { room, join, input, steps, received } = setup();
    const a = join(0, 2.6);
    input(a, { throwKnife: true, bareHand: true });
    steps(1);
    expect(received(a.id, 'knife')).toHaveLength(0);
    expect(room.snapshotOf(a).armed).toBe(false);
    input(a, { throwKnife: true });
    steps(1);
    expect(received(a.id, 'knife')).toHaveLength(1);
    expect(room.snapshotOf(a).armed).toBe(true);
  });

  it('ignores throws inside the cooldown', () => {
    const { join, input, steps, received } = setup();
    const a = join(0, 2.6);
    // Mashing F: a throw on every input, one input per tick.
    for (let i = 0; i <= KNIFE_COOLDOWN_INPUTS; i++) {
      input(a, { throwKnife: true });
      steps(1);
    }
    steps(2);
    expect(received(a.id, 'knife').map((k) => k.seq)).toEqual([0, KNIFE_COOLDOWN_INPUTS]);
  });

  it('checks a knife against where its thrower saw the target, not where they are now', () => {
    /** The target stands still, then steps aside just before the throw lands on the server. */
    const throwAtSteppedAside = (compensate: boolean): number => {
      const { room, join, input, steps, received } = setup();
      const thrower = join(0, 5.6);
      const target = join(0, 3.2);
      steps(2);
      // What the thrower's screen showed: the target, still standing in the knife's path.
      const seenAt = room.tick;
      // Long enough ago that the whole flight is checked against the past.
      steps(FLIGHT);
      target.state.x += 2;
      input(thrower, { throwKnife: true, pitch: -0.1, view: compensate ? seenAt : undefined });
      steps(FLIGHT);
      return received(thrower.id, 'kill').length;
    };
    expect(throwAtSteppedAside(true)).toBe(1);
    expect(throwAtSteppedAside(false)).toBe(0);
  });

  it('does not rewind further than the server allows', () => {
    const { room, join, input, steps, received } = setup();
    const thrower = join(0, 5.6);
    const target = join(0, 3.2);
    steps(2);
    const seenAt = room.tick;
    // Long gone: far more than the rewind window ago.
    target.state.x += 2;
    steps(MAX_REWIND_TICKS + 5);
    input(thrower, { throwKnife: true, pitch: -0.1, view: seenAt });
    steps(FLIGHT);
    expect(received(thrower.id, 'kill')).toHaveLength(0);
  });

  it('keeps a knocked-out player from walking away', () => {
    const { join, input, steps } = setup();
    const thrower = join(0, 5.6);
    const victim = join(0, 3.2);
    input(thrower, { throwKnife: true, pitch: -0.1 });
    steps(FLIGHT);
    const before = { x: victim.state.x, z: victim.state.z };
    for (let i = 0; i < 10; i++) input(victim, { keys: Keys.Left | Keys.Sprint });
    steps(10);
    expect(victim.state.x).toBeCloseTo(before.x, 3);
    expect(victim.state.z).toBeCloseTo(before.z, 3);
  });
});
