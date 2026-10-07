import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  COOLER,
  COOLER_HITS_TO_OPEN,
  COOLER_OPEN_DELAY_INPUTS,
  DOORS,
  EYE_HEIGHT,
  KNIFE_COOLDOWN_INPUTS,
  Keys,
  PLAY_HALF_X,
  PROTOCOL_VERSION,
  PUNCH_COOLDOWN_INPUTS,
  ROOM_HALF_X,
  SNAPSHOT_EVERY_TICKS,
  TICK_MS,
  TICK_RATE,
  coolerColliders,
  createPlayerState,
  encode,
  parseServerMessage,
  stepPlayer,
  type PlayerState,
  type ServerMessage,
} from '@world/shared';
import { Room, type RoomPlayer } from './room.ts';
import { startServer, type WorldServer } from './server.ts';

const EAST = -Math.PI / 2;
const DOOR_Z = -3;

type Inbox = ServerMessage[];

function setup() {
  const room = new Room('cooler');
  const inboxes = new Map<number, Inbox>();
  const raw = new Map<number, string[]>();
  let nextId = 1;
  const join = (x: number, z: number, yaw = EAST): RoomPlayer => {
    const id = nextId++;
    const inbox: Inbox = [];
    const wire: string[] = [];
    inboxes.set(id, inbox);
    raw.set(id, wire);
    return room.add({
      id,
      name: `P${id}`,
      spawn: { x, z, yaw },
      send: (data) => {
        wire.push(data);
        const message = parseServerMessage(data);
        if (message && message.t !== 'snap') inbox.push(message);
      },
    });
  };
  const seqs = new Map<number, number>();
  /** Queue one input, as a client sends one each tick. Returns its sequence number. */
  const input = (player: RoomPlayer, keys: number, yaw = EAST, pitch = 0): number => {
    const seq = seqs.get(player.id) ?? 0;
    seqs.set(player.id, seq + 1);
    room.enqueueInput(player, { seq, keys, yaw, pitch });
    return seq;
  };
  /** One tick with an input from each of `players`, doing `keys`. */
  const tick = (players: readonly RoomPlayer[], keys: number, yaw = EAST, pitch = 0): void => {
    for (const p of players) input(p, keys, yaw, pitch);
    room.step();
  };
  /** Punch with the bare hand, then wait out the cooldown. */
  const punch = (player: RoomPlayer, yaw = EAST, pitch = 0): void => {
    tick([player], Keys.Punch, yaw, pitch);
    for (let i = 1; i < PUNCH_COOLDOWN_INPUTS; i++) tick([player], 0, yaw, pitch);
  };
  const hits = (id: number) =>
    inboxes.get(id)!.filter((m): m is Extract<ServerMessage, { t: 'cooler' }> => m.t === 'cooler');
  return { room, join, input, tick, punch, hits, inboxes, raw };
}

describe("the walk-in's door", () => {
  it('counts every bare-hand punch that lands on it, and tells everyone where', () => {
    const { room, join, punch, hits } = setup();
    const boxer = join(ROOM_HALF_X - 0.7, DOOR_Z);
    const watcher = join(0, 5.6, 0);
    punch(boxer);
    expect(room.cooler.hits).toBe(1);
    const expected = {
      t: 'cooler',
      from: boxer.id,
      dent: { z: DOOR_Z, y: EYE_HEIGHT, by: 'fist' },
    };
    // The puncher hears of it too: their screen dents the door when the server says so.
    expect(hits(watcher.id)).toEqual([expected]);
    expect(hits(boxer.id)).toEqual([expected]);
  });

  it('ignores punches out of reach, facing away, with the knife out, or in the cooldown', () => {
    const { room, join, tick, punch } = setup();
    const far = join(ROOM_HALF_X - 2, DOOR_Z);
    punch(far);
    const near = join(ROOM_HALF_X - 0.7, DOOR_Z);
    punch(near, 0);
    tick([near], Keys.Punch | Keys.Armed);
    expect(room.cooler.hits).toBe(0);
    for (let i = 0; i <= PUNCH_COOLDOWN_INPUTS; i++) tick([near], Keys.Punch);
    // The first punch and the one after the cooldown.
    expect(room.cooler.hits).toBe(2);
  });

  it('counts knives that stick in it, with the knife, so screens dent it as the knife arrives', () => {
    const { room, join, tick, hits } = setup();
    const thrower = join(4, DOOR_Z);
    tick([thrower], Keys.Armed | Keys.Throw);
    for (let i = 0; i < TICK_RATE / 2; i++) tick([thrower], Keys.Armed);
    expect(room.cooler.hits).toBe(1);
    const [hit] = hits(thrower.id);
    expect(hit?.dent.by).toBe('knife');
    expect(hit?.knife?.at).toBeGreaterThan(0);
    const stuck = room.stuckKnives();
    expect(stuck.map((k) => k.id)).toEqual([hit?.knife?.id]);
    // A knife in the wall beside the door is just a knife in a wall.
    for (let i = 0; i < KNIFE_COOLDOWN_INPUTS; i++) tick([thrower], Keys.Armed);
    tick([thrower], Keys.Armed | Keys.Throw, EAST + 0.5);
    for (let i = 0; i < TICK_RATE / 2; i++) tick([thrower], Keys.Armed);
    expect(room.stuckKnives()).toHaveLength(2);
    expect(room.cooler.hits).toBe(1);
  });

  it(`bursts open on the ${COOLER_HITS_TO_OPEN}th hit, then takes no more`, () => {
    const { room, join, punch, hits } = setup();
    const boxer = join(ROOM_HALF_X - 0.7, DOOR_Z);
    for (let i = 0; i < COOLER_HITS_TO_OPEN - 1; i++) punch(boxer, EAST + (i - 4) * 0.08);
    expect(room.cooler.burst).toBe(false);
    expect(hits(boxer.id).every((m) => m.openFrom === undefined)).toBe(true);
    punch(boxer);
    expect(room.cooler.burst).toBe(true);
    expect(hits(boxer.id).at(-1)?.openFrom).toBeGreaterThan(0);
    punch(boxer);
    expect(room.cooler.hits).toBe(COOLER_HITS_TO_OPEN);
    expect(hits(boxer.id)).toHaveLength(COOLER_HITS_TO_OPEN);
  });

  it("opens the doorway for each cook from an input of theirs it names, ahead of what they've sent", () => {
    const { join, input, room, punch, hits } = setup();
    const boxer = join(ROOM_HALF_X - 0.7, DOOR_Z);
    const lagging = join(0, 5.6, 0);
    for (let i = 0; i < COOLER_HITS_TO_OPEN - 1; i++) punch(boxer);
    // The lagging cook has inputs queued that the room has not simulated yet.
    for (let i = 0; i < 5; i++) input(lagging, 0, 0);
    const burst = input(boxer, Keys.Punch);
    room.step();
    expect(room.cooler.burst).toBe(true);
    expect(hits(boxer.id).at(-1)?.openFrom).toBe(burst + COOLER_OPEN_DELAY_INPUTS);
    const newestQueued = lagging.queue.at(-1)!.seq;
    expect(newestQueued).toBe(4);
    expect(hits(lagging.id).at(-1)?.openFrom).toBe(newestQueued + COOLER_OPEN_DELAY_INPUTS);
  });

  it('lets the cook walk in exactly as their own prediction does, without a correction', () => {
    const { room, join, tick, raw } = setup();
    const boxer = join(ROOM_HALF_X - 0.7, DOOR_Z);
    // The client: the same shared simulation, told by the server when the doorway opens for it.
    const client: PlayerState = createPlayerState(ROOM_HALF_X - 0.7, DOOR_Z, EAST);
    stepPlayer(client, { keys: 0, yaw: EAST, pitch: 0 }); // the server's settle step
    let openFrom = Infinity;
    let seq = 0;
    let compared = 0;
    const step = (keys: number): void => {
      tick([boxer], keys);
      stepPlayer(client, { keys, yaw: EAST, pitch: 0 }, coolerColliders(seq >= openFrom));
      seq++;
      for (const data of raw.get(boxer.id)!.splice(0)) {
        const message = parseServerMessage(data);
        if (message?.t === 'cooler' && message.openFrom !== undefined) openFrom = message.openFrom;
        if (message?.t !== 'snap') continue;
        const snap = message.players.find((p) => p.id === boxer.id)!;
        const { x, y, z, vx, vy, vz, grounded } = client;
        expect({ x: snap.x, y: snap.y, z: snap.z, vx: snap.vx, vy: snap.vy, vz: snap.vz }).toEqual({
          x,
          y,
          z,
          vx,
          vy,
          vz,
        });
        expect(snap.grounded).toBe(grounded);
        compared++;
      }
    };
    // Punching while pushing at the door, all the way through the burst.
    for (let i = 0; i < COOLER_HITS_TO_OPEN; i++) {
      step(Keys.Punch | Keys.Forward);
      for (let k = 1; k < PUNCH_COOLDOWN_INPUTS; k++) step(Keys.Forward);
    }
    expect(room.cooler.burst).toBe(true);
    expect(boxer.state.x).toBeCloseTo(PLAY_HALF_X, 3);
    for (let i = 0; i < TICK_RATE * 2; i++) step(Keys.Forward);
    expect(boxer.state.x).toBeCloseTo(COOLER.maxX - 0.4, 3);
    expect(compared).toBeGreaterThan((TICK_RATE * 2) / SNAPSHOT_EVERY_TICKS);
  });

  it('lets knives through the doorway once the door has swung clear', () => {
    const { room, join, tick, punch } = setup();
    const boxer = join(ROOM_HALF_X - 0.7, DOOR_Z);
    for (let i = 0; i < COOLER_HITS_TO_OPEN; i++) punch(boxer);
    for (let i = 0; i < COOLER_OPEN_DELAY_INPUTS; i++) tick([boxer], 0);
    // Past the boxer, who still stands before the doorway.
    const thrower = join(6.4, DOOR_Z - 0.6);
    tick([thrower], Keys.Armed | Keys.Throw);
    for (let i = 0; i < TICK_RATE / 2; i++) tick([thrower], Keys.Armed);
    const [knife] = room.stuckKnives();
    expect(knife?.x).toBeGreaterThan(COOLER.maxX - 0.01);
    expect(room.cooler.hits).toBe(COOLER_HITS_TO_OPEN);
  });

  it('is open at once for a cook who arrives after it burst, and in the welcome', () => {
    const { room, join, tick, punch } = setup();
    const boxer = join(ROOM_HALF_X - 0.7, DOOR_Z);
    for (let i = 0; i < COOLER_HITS_TO_OPEN; i++) punch(boxer, EAST + (i % 3) * 0.1);
    const late = join(ROOM_HALF_X - 1, DOOR_Z);
    expect(late.coolerFrom).toBe(0);
    for (let i = 0; i < TICK_RATE * 2; i++) tick([late], Keys.Forward);
    expect(late.state.x).toBeGreaterThan(COOLER.minX);
    const state = room.coolerState();
    expect(state.dents).toHaveLength(COOLER_HITS_TO_OPEN);
    expect(state.dents[0]).toEqual({ z: DOOR_Z, y: EYE_HEIGHT, by: 'fist' });
    // A spawn hint inside the open cooler stands; the same hint in a fresh room does not.
    const hinted = room.add({
      id: 900,
      name: 'Back',
      send: () => {},
      spawn: { x: COOLER.minX + 1.5, z: -4, yaw: 0 },
    });
    expect(hinted.state.x).toBeCloseTo(COOLER.minX + 1.5, 3);
    const fresh = new Room('fresh').add({
      id: 901,
      name: 'Back',
      send: () => {},
      spawn: { x: COOLER.minX + 1.5, z: -4, yaw: 0 },
    });
    expect(fresh.state.x).toBeLessThan(PLAY_HALF_X + 1e-6);
  });
});

describe("the walk-in's door, over the wire", () => {
  let server: WorldServer;
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    await server.close();
  });

  /** Join `room` from a spawn by the walk-in; resolves with the welcome and a way to send. */
  async function joinRoom(room: string, name: string) {
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    sockets.push(ws);
    const messages: ServerMessage[] = [];
    ws.on('message', (data: Buffer) => {
      const message = parseServerMessage(data.toString());
      if (message) messages.push(message);
    });
    await new Promise<void>((resolve) => ws.once('open', () => resolve()));
    const spawn = { x: ROOM_HALF_X - 0.7, z: DOOR_Z, yaw: EAST };
    ws.send(encode({ t: 'hello', v: PROTOCOL_VERSION, name, room, spawn }));
    const welcome = await waitFor(() => messages.find((m) => m.t === 'welcome'));
    return { ws, messages, welcome };
  }

  async function waitFor<T>(check: () => T | undefined, timeoutMs = 4000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = check();
      if (found !== undefined) return found;
      if (Date.now() > deadline) throw new Error('timed out');
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  it("tells a late arrival every dent, and is whole again once everyone's gone", async () => {
    server = await startServer({ port: 0, host: '127.0.0.1' });
    const boxer = await joinRoom('walk-in', 'Boxer');
    expect(boxer.welcome.cooler).toEqual({ dents: [] });
    let seq = 0;
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < PUNCH_COOLDOWN_INPUTS; k++) {
        const keys = k === 0 ? Keys.Punch : 0;
        boxer.ws.send(encode({ t: 'input', seq: seq++, keys, yaw: EAST, pitch: 0 }));
        // One a tick, as a client sends them.
        await new Promise((r) => setTimeout(r, TICK_MS));
      }
    }
    await waitFor(() => (server.rooms.get('walk-in')?.cooler.hits === 3 ? true : undefined));
    const late = await joinRoom('walk-in', 'Late');
    expect(late.welcome.cooler?.dents).toHaveLength(3);
    expect(late.welcome.cooler?.dents[0]).toMatchObject({ z: DOOR_Z, by: 'fist' });
    expect(late.welcome.cooler?.dents[0]?.z).toBeGreaterThan(DOORS.walkIn.from);

    for (const { ws } of [boxer, late]) ws.close();
    await waitFor(() => (server.rooms.has('walk-in') ? undefined : true));
    const next = await joinRoom('walk-in', 'Next');
    expect(next.welcome.cooler).toEqual({ dents: [] });
  });
});
