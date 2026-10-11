import { describe, expect, it } from 'vitest';
import { KNIFE_COOLDOWN_INPUTS, Keys, MAX_HEALTH, TICK_RATE } from '@world/shared';
import { DEATH_TICKS, PROTECTION_TICKS } from './room.ts';
import { FLIGHT, knifeRoom } from './testRoom.ts';

describe('health', () => {
  it('is full for every cook who comes into the room, Chef Skinner included', () => {
    const { add } = knifeRoom();
    const a = add(0, 5.6);
    const chef = add(3, 5.6, { resident: true });
    expect(MAX_HEALTH).toBe(3);
    for (const cook of [a, chef]) expect(cook.health).toBe(MAX_HEALTH);
  });

  it('takes one hit at a time, and the third knocks the cook out', () => {
    const { room, target, thrower, throwAt, received } = knifeRoom();
    const a = thrower();
    const b = target();
    const bystander = thrower();

    throwAt(a, b);
    expect(b.health).toBe(2);
    expect(room.snapshotOf(b).dead).toBe(false);
    throwAt(a, b);
    expect(b.health).toBe(1);
    expect(room.snapshotOf(b).dead).toBe(false);
    expect(received(b.id, 'kill')).toEqual([]);
    throwAt(a, b);
    expect(b.health).toBe(0);
    expect(room.snapshotOf(b).dead).toBe(true);
    expect(b.deadUntil).not.toBeNull();

    // Everyone heard of the first two as hits, with the health the cook had left, and of the
    // third as the knockout: the victim, the thrower and the cook who only watched.
    for (const cook of [a, b, bystander]) {
      expect(received(cook.id, 'hit'), `${cook.name} heard`).toMatchObject([
        { from: a.id, to: b.id, health: 2 },
        { from: a.id, to: b.id, health: 1 },
      ]);
      expect(received(cook.id, 'kill'), `${cook.name} heard`).toMatchObject([
        { from: a.id, to: b.id },
      ]);
    }
  });

  it('says when each knife arrives, as it does for a knockout, and names the knife', () => {
    const { target, thrower, throwAt, received } = knifeRoom();
    const a = thrower();
    const b = target();
    throwAt(a, b);
    const [hit] = received(b.id, 'hit');
    const [knife] = received(b.id, 'knife');
    expect(hit!.knife).toBe(knife!.id);
    // Some of a tenth of a second of flight to reach them 2.4 m away, and no more than that.
    expect(hit!.at).toBeGreaterThan(0.02);
    expect(hit!.at).toBeLessThan(0.3);
  });

  it('counts hits from any cook, not only from one', () => {
    const { target, thrower, throwAt, received } = knifeRoom();
    const [a, c, d] = [thrower(), thrower(), thrower()] as const;
    const b = target();
    throwAt(a, b);
    throwAt(c, b);
    expect(b.health).toBe(1);
    throwAt(d, b);
    expect(b.deadUntil).not.toBeNull();
    expect(received(b.id, 'kill')).toMatchObject([{ from: d.id, to: b.id }]);
  });

  it('leaves a cook who has been hit standing, able to walk and throw', () => {
    const { thrower, target, throwAt, input, steps, received } = knifeRoom();
    const a = thrower();
    const b = target();
    throwAt(a, b);
    const before = { x: b.state.x, z: b.state.z };
    input(b, Keys.Forward);
    input(b, Keys.Forward);
    input(b, Keys.Throw, 0, -1.2);
    steps(FLIGHT);
    expect(Math.hypot(b.state.x - before.x, b.state.z - before.z)).toBeGreaterThan(0.01);
    expect(received(a.id, 'knife').some((k) => k.from === b.id)).toBe(true);
  });

  it('does not come back on its own, however long a hit cook is left alone', () => {
    const { thrower, target, throwAt, steps } = knifeRoom();
    const a = thrower();
    const b = target();
    throwAt(a, b);
    steps(TICK_RATE * 60);
    expect(b.health).toBe(2);
  });

  it('is full again once the cook is back on their feet, and a new run of three is needed', () => {
    const { room, thrower, target, throwAt, throwsAt, standUp, received } = knifeRoom();
    const a = thrower();
    const b = target();
    throwsAt(a, b, 2);
    expect(b.health).toBe(1);
    throwAt(a, b);
    expect(b.health).toBe(0);
    standUp(b);
    expect(b.health).toBe(MAX_HEALTH);
    expect(b.deadUntil).toBeNull();
    expect(room.snapshotOf(b).dead).toBe(false);

    // The hits before the knockout are not remembered: one hit is one hit.
    throwAt(a, b);
    expect(b.health).toBe(MAX_HEALTH - 1);
    expect(received(b.id, 'kill')).toHaveLength(1);
    expect(received(b.id, 'hit').map((hit) => hit.health)).toEqual([2, 1, 2]);
  });

  it('is not taken from a cook who has just got back up and is protected', () => {
    const { thrower, target, throwsAt, throwAt, steps, standUp, received } = knifeRoom();
    const a = thrower();
    const b = target();
    throwsAt(a, b, 3);
    // Up again, but only just: knives fly on through, and the cook keeps all they have.
    steps(DEATH_TICKS);
    expect(b.deadUntil).toBeNull();
    Object.assign(b.state, { x: 0, z: 3.2, vx: 0, vz: 0 });
    throwAt(a, b);
    expect(b.health).toBe(MAX_HEALTH);
    expect(received(b.id, 'hit')).toHaveLength(2);
    expect(PROTECTION_TICKS).toBeGreaterThan(KNIFE_COOLDOWN_INPUTS);
    standUp(b);
    throwAt(a, b);
    expect(b.health).toBe(MAX_HEALTH - 1);
  });

  it('cannot be taken from a cook who is already down', () => {
    const { thrower, target, throwsAt, throwAt, received } = knifeRoom();
    const a = thrower();
    const b = target();
    throwsAt(a, b, 3);
    throwAt(a, b);
    // The fourth knife went through them: no third hit, no second knockout.
    expect(b.health).toBe(0);
    expect(received(a.id, 'hit')).toHaveLength(2);
    expect(received(a.id, 'kill')).toHaveLength(1);
  });

  it('lands a knife whose thrower has left the room since it flew', () => {
    const { room, thrower, target, throwAt, input, steps, received } = knifeRoom();
    const a = thrower();
    const b = target();
    const watcher = thrower();
    throwAt(a, b);
    // The next knife is thrown, and its thrower leaves with it still in the air.
    const yaw = Math.atan2(a.state.x - b.state.x, a.state.z - b.state.z);
    for (let i = 0; i < KNIFE_COOLDOWN_INPUTS; i++) input(a, 0, yaw);
    input(a, Keys.Throw, yaw, -0.1);
    steps(KNIFE_COOLDOWN_INPUTS + 1);
    room.remove(a.id);
    steps(FLIGHT);
    expect(b.health).toBe(1);
    expect(received(watcher.id, 'hit').map((hit) => [hit.from, hit.health])).toEqual([
      [a.id, 2],
      [a.id, 1],
    ]);
  });

  it('tells the room of a knockout, and only a knockout, through onKnockout', () => {
    const { room, thrower, target, throwAt } = knifeRoom();
    const a = thrower();
    const b = target();
    const told: [number, number][] = [];
    room.onKnockout = (from, to) => told.push([from, to]);
    throwAt(a, b);
    throwAt(a, b);
    expect(told).toEqual([]);
    throwAt(a, b);
    expect(told).toEqual([[a.id, b.id]]);
  });

  it('is taken from Chef Skinner the same way, and given back when he gets up', () => {
    const { room, thrower, add, throwAt, throwsAt, standUp, received } = knifeRoom();
    const a = thrower();
    const chef = add(0, 3.2, { resident: true });
    throwAt(a, chef);
    expect(chef.health).toBe(2);
    throwsAt(a, chef, 2);
    expect(chef.deadUntil).not.toBeNull();
    expect(received(a.id, 'kill')).toMatchObject([{ from: a.id, to: chef.id }]);
    standUp(chef);
    expect(chef.health).toBe(MAX_HEALTH);
    expect(room.snapshotOf(chef).dead).toBe(false);
  });

  it("is taken by Chef Skinner's knives the same way", () => {
    const { thrower, target, throwAt, received } = knifeRoom();
    const chef = thrower({ resident: true });
    const b = target();
    throwAt(chef, b);
    expect(b.health).toBe(2);
    expect(received(b.id, 'hit')).toMatchObject([{ from: chef.id, to: b.id, health: 2 }]);
  });

  it('is not taken by Chef Skinner from a cook who turned him off, nor by anyone else less', () => {
    const { thrower, add, throwAt, received } = knifeRoom();
    const chef = thrower({ resident: true });
    const off = add(0, 3.2, { chef: false });
    throwAt(chef, off);
    expect(off.health).toBe(MAX_HEALTH);
    expect(received(off.id, 'hit')).toEqual([]);
    const visitor = thrower();
    throwAt(visitor, off);
    expect(off.health).toBe(MAX_HEALTH - 1);
  });
});
