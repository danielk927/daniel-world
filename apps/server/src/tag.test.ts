import { describe, expect, it } from 'vitest';
import {
  Keys,
  TAG_NO_TAGBACK_SECONDS,
  TAG_ROUND_SECONDS,
  TICK_RATE,
  parseServerMessage,
  type ServerMessage,
} from '@world/shared';
import { Room, type RoomPlayer } from './room.ts';

function setup(code = 'tag-test') {
  // Deterministic "random": always pick the first candidate.
  const room = new Room(code, () => 0);
  const inbox: ServerMessage[] = [];
  let nextId = 1;
  const join = (x: number, z: number): RoomPlayer =>
    room.add({
      id: nextId++,
      name: `P${nextId}`,
      spawn: { x, z, yaw: 0 },
      send: (d) => {
        const m = parseServerMessage(d);
        if (m && m.t !== 'snap') inbox.push(m);
      },
    });
  const place = (p: RoomPlayer, x: number, z: number): void => {
    p.state.x = x;
    p.state.z = z;
  };
  const games = () =>
    inbox.filter((m): m is Extract<ServerMessage, { t: 'game' }> => m.t === 'game');
  return { room, inbox, join, place, games };
}

describe('tag', () => {
  it('only starts in private rooms with at least two players', () => {
    const lobby = setup('lobby');
    lobby.join(0, 3);
    lobby.join(5, 3);
    expect(lobby.room.startTag()).toBe(false);

    const solo = setup();
    solo.join(0, 3);
    expect(solo.room.startTag()).toBe(false);

    const { room, join, games } = setup();
    join(0, 3);
    join(6, 3);
    expect(room.startTag()).toBe(true);
    expect(room.startTag()).toBe(false);
    expect(games()[0]).toMatchObject({ phase: 'playing', it: 1 });
  });

  it('passes it on contact, without instant tag-backs', () => {
    const { room, join, place, inbox } = setup();
    const a = join(-6, 3);
    const b = join(6, 3);
    room.startTag();
    expect(room.game?.it).toBe(a.id);

    place(a, 5.5, 3);
    room.step();
    expect(room.game?.it).toBe(b.id);
    expect(inbox).toContainEqual({ t: 'tagged', from: a.id, to: b.id });

    // b is right next to a but cannot tag straight back...
    for (let i = 0; i < TAG_NO_TAGBACK_SECONDS * TICK_RATE - 2; i++) room.step();
    expect(room.game?.it).toBe(b.id);
    // ...until the grace period is over.
    room.step();
    room.step();
    expect(room.game?.it).toBe(a.id);
  });

  it('scores seconds spent not being it and ends after the round', () => {
    const { room, join, games } = setup();
    const a = join(-6, 3);
    const b = join(6, 3);
    room.startTag();
    for (let i = 0; i < TAG_ROUND_SECONDS * TICK_RATE; i++) {
      // Keep them apart so it never changes hands.
      room.enqueueInput(a, { seq: i, keys: 0, yaw: 0, pitch: 0 });
      room.enqueueInput(b, { seq: i, keys: 0, yaw: 0, pitch: 0 });
      room.step();
    }
    const last = games().at(-1)!;
    expect(last.phase).toBe('ended');
    expect(last.it).toBeNull();
    expect(last.scores).toEqual([
      { id: b.id, score: TAG_ROUND_SECONDS },
      { id: a.id, score: 0 },
    ]);
    expect(room.game).toBeNull();
    // Roughly one state update per second, not per tick (each broadcast reaches both players).
    expect(games().length / 2).toBeLessThan(TAG_ROUND_SECONDS + 5);
  });

  it('hands it to someone else when it leaves, and ends when too few remain', () => {
    const { room, join, games } = setup();
    const a = join(-6, 3);
    const b = join(6, 3);
    const c = join(0, -5.2);
    room.startTag();
    expect(room.game?.it).toBe(a.id);
    room.remove(a.id);
    expect(room.game?.it).toBe(b.id);
    room.remove(c.id);
    expect(room.game).toBeNull();
    expect(games().at(-1)?.phase).toBe('ended');
  });

  it('includes late joiners in the scoreboard', () => {
    const { room, join, games } = setup();
    join(-6, 3);
    join(6, 3);
    room.startTag();
    const late = join(0, -5.2);
    for (let i = 0; i < TICK_RATE; i++) room.step();
    expect(
      games()
        .at(-1)
        ?.scores.map((s) => s.id),
    ).toContain(late.id);
  });

  it('keeps movement authoritative while playing', () => {
    const { room, join } = setup();
    const a = join(-6, 3);
    join(6, 3);
    room.startTag();
    room.enqueueInput(a, { seq: 0, keys: Keys.Right | Keys.Sprint, yaw: 0, pitch: 0 });
    room.step();
    expect(a.state.x).toBeGreaterThan(-6);
  });
});
