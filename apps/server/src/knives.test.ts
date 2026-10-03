import { describe, expect, it } from 'vitest';
import {
  KNIFE_COOLDOWN_INPUTS,
  KNIFE_MAX_STUCK,
  Keys,
  parseServerMessage,
  type ServerMessage,
} from '@world/shared';
import { MAX_REWIND_TICKS } from './knives.ts';
import { DEATH_TICKS, PROTECTION_TICKS, Room, type RoomPlayer } from './room.ts';

/** Yaw that looks along -Z (north), the way the spawn faces. */
const NORTH = 0;

function setup() {
  const room = new Room('knives');
  const inboxes = new Map<number, ServerMessage[]>();
  let nextId = 1;
  const join = (x: number, z: number): RoomPlayer => {
    const id = nextId++;
    const inbox: ServerMessage[] = [];
    inboxes.set(id, inbox);
    const player = room.add({
      id,
      name: `P${id}`,
      spawn: { x, z, yaw: NORTH },
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
    options: { throwKnife?: boolean; keys?: number; yaw?: number; pitch?: number; view?: number },
  ): void => {
    const seq = seqs.get(player.id) ?? 0;
    seqs.set(player.id, seq + 1);
    room.enqueueInput(player, {
      seq,
      keys: (options.keys ?? 0) | (options.throwKnife ? Keys.Throw : 0),
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

  it('knocks out a player it hits, who respawns protected after a while', () => {
    const { room, join, input, steps, received } = setup();
    const thrower = join(0, 5.6);
    const victim = join(0, 3.2);
    // Aim a little down so the knife meets the victim's chest, not their toque.
    input(thrower, { throwKnife: true, pitch: -0.1 });
    steps(3);
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
    steps(KNIFE_COOLDOWN_INPUTS + 3);
    expect(received(thrower.id, 'knife')).toHaveLength(2);
    expect(received(thrower.id, 'kill')).toHaveLength(1);
    expect(PROTECTION_TICKS).toBeGreaterThan(KNIFE_COOLDOWN_INPUTS);
  });

  it('sticks knives where they land and keeps only the newest for newcomers', () => {
    const { room, join, input, steps, received } = setup();
    const a = join(0, 2.6);
    // Straight down into the aisle floor.
    input(a, { throwKnife: true, pitch: -Math.PI / 2 + 0.01 });
    steps(4);
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
    steps(4);
    const knives = room.stuckKnives();
    expect(knives).toHaveLength(KNIFE_MAX_STUCK);
    // Oldest first, and the oldest few were dropped.
    expect(knives[0]!.id).toBe(6);
    expect(knives.at(-1)!.id).toBe(KNIFE_MAX_STUCK + 5);
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
      steps(2);
      target.state.x += 2;
      input(thrower, { throwKnife: true, pitch: -0.1, view: compensate ? seenAt : undefined });
      steps(4);
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
    steps(3);
    expect(received(thrower.id, 'kill')).toHaveLength(0);
  });

  it('keeps a knocked-out player from walking away', () => {
    const { join, input, steps } = setup();
    const thrower = join(0, 5.6);
    const victim = join(0, 3.2);
    input(thrower, { throwKnife: true, pitch: -0.1 });
    steps(3);
    const before = { x: victim.state.x, z: victim.state.z };
    for (let i = 0; i < 10; i++) input(victim, { keys: Keys.Left | Keys.Sprint });
    steps(10);
    expect(victim.state.x).toBeCloseTo(before.x, 3);
    expect(victim.state.z).toBeCloseTo(before.z, 3);
  });
});
