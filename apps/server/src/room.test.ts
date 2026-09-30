import { describe, expect, it } from 'vitest';
import {
  Keys,
  MAX_PLAYERS_PER_ROOM,
  SPAWN,
  createPlayerState,
  parseServerMessage,
  stepPlayer,
  type PlayerState,
  type SnapshotMessage,
} from '@world/shared';
import {
  IDLE_STEP_AFTER_TICKS,
  MAX_INPUT_CREDIT,
  MAX_QUEUED_INPUTS,
  Room,
  type QueuedInput,
} from './room.ts';

function makeRoom() {
  const room = new Room('test');
  const inbox = new Map<number, string[]>();
  let nextId = 1;
  const join = (name = 'P') => {
    const id = nextId++;
    const messages: string[] = [];
    inbox.set(id, messages);
    // Everyone at the default spawn, so tests can mirror the server with a plain client state.
    return room.add({ id, name, spawn: SPAWN, send: (d) => messages.push(d) });
  };
  const lastSnapshot = (id: number): SnapshotMessage => {
    const messages = inbox.get(id)!;
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = parseServerMessage(messages[i]);
      if (m?.t === 'snap') return m;
    }
    throw new Error('no snapshot');
  };
  return { room, inbox, join, lastSnapshot };
}

function scriptedInputs(count: number): QueuedInput[] {
  return Array.from({ length: count }, (_, i) => ({
    seq: i,
    keys: [Keys.Forward, Keys.Forward | Keys.Sprint, Keys.Left | Keys.Jump, Keys.Back, 0][i % 5]!,
    yaw: Math.sin(i * 0.07) * 2,
    pitch: Math.cos(i * 0.11) * 0.5,
  }));
}

describe('Room', () => {
  it('announces joins and leaves to the other players', () => {
    const { room, inbox, join } = makeRoom();
    const a = join('A');
    const b = join('B');
    expect(inbox.get(a.id)!.map((m) => JSON.parse(m) as { t: string })).toContainEqual({
      t: 'join',
      player: { id: b.id, name: 'B', color: b.color },
    });
    expect(inbox.get(b.id)).toHaveLength(0);
    room.remove(b.id);
    expect(JSON.parse(inbox.get(a.id)!.at(-1)!)).toEqual({ t: 'leave', id: b.id });
  });

  it('gives each player a distinct color and reports when full', () => {
    const { room, join } = makeRoom();
    const colors = new Set<string>();
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i++) colors.add(join().color);
    expect(colors.size).toBe(MAX_PLAYERS_PER_ROOM);
    expect(room.isFull).toBe(true);
  });

  it('applies at most one input per tick on average', () => {
    const { room, join } = makeRoom();
    const p = join();
    // A cheater sends 100 inputs at once.
    for (const input of scriptedInputs(100))
      room.enqueueInput(p, { ...input, keys: Keys.Forward | Keys.Sprint });
    expect(p.queue.length).toBe(MAX_QUEUED_INPUTS);
    room.step();
    // One credit from the start plus one for the tick.
    expect(p.lastSeq).toBe(100 - MAX_QUEUED_INPUTS + 1);
    for (let i = 0; i < 3; i++) room.step();
    expect(p.lastSeq).toBe(100 - MAX_QUEUED_INPUTS + 4);
  });

  it('banks a little credit so a late burst catches up', () => {
    const { room, join } = makeRoom();
    const p = join();
    for (let i = 0; i < 10; i++) room.step(); // no inputs arrive
    for (const input of scriptedInputs(MAX_INPUT_CREDIT)) room.enqueueInput(p, input);
    room.step();
    expect(p.lastSeq).toBe(MAX_INPUT_CREDIT - 1);
    expect(p.queue).toHaveLength(0);
  });

  it('keeps simulating a player who goes silent mid-jump', () => {
    const { room, join } = makeRoom();
    const p = join();
    room.enqueueInput(p, { seq: 0, keys: Keys.Jump, yaw: 0, pitch: 0 });
    room.step();
    expect(p.state.grounded).toBe(false);
    for (let i = 0; i < IDLE_STEP_AFTER_TICKS + 30; i++) room.step();
    expect(p.state.grounded).toBe(true);
  });

  it('ignores duplicate and out-of-order inputs', () => {
    const { room, join } = makeRoom();
    const p = join();
    room.enqueueInput(p, { seq: 5, keys: 0, yaw: 0, pitch: 0 });
    room.enqueueInput(p, { seq: 5, keys: Keys.Forward, yaw: 0, pitch: 0 });
    room.enqueueInput(p, { seq: 3, keys: Keys.Forward, yaw: 0, pitch: 0 });
    expect(p.queue.map((q) => q.seq)).toEqual([5]);
    room.step();
    room.enqueueInput(p, { seq: 4, keys: Keys.Forward, yaw: 0, pitch: 0 });
    expect(p.queue).toHaveLength(0);
  });

  it('simulates bit-identically to a client running the shared sim on the same inputs', () => {
    const { room, join, lastSnapshot } = makeRoom();
    const p = join();
    const client: PlayerState = createPlayerState();
    stepPlayer(client, { keys: 0, yaw: client.yaw, pitch: 0 }); // matches the server's settle step
    for (const input of scriptedInputs(600)) {
      room.enqueueInput(p, input);
      room.step();
      stepPlayer(client, input);
      // Compare what actually crossed the wire, after JSON encoding.
      const snap = lastSnapshot(p.id).players.find((s) => s.id === p.id)!;
      expect(snap.ack).toBe(input.seq);
      expect({ ...snap }).toEqual({ ...client, id: p.id, ack: input.seq });
    }
  });

  it('clamps and settles a spawn hint', () => {
    const { room } = makeRoom();
    const p = room.add({ id: 99, name: 'X', send: () => {}, spawn: { x: 0, z: 0, yaw: 0 } });
    // Spawned inside the fountain: pushed out of it.
    expect(Math.hypot(p.state.x, p.state.z)).toBeGreaterThan(2.8);
  });
});
