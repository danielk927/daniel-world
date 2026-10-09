import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  CHAT_MAX_LENGTH,
  KNIFE_COOLDOWN_INPUTS,
  Keys,
  MAX_PLAYERS_PER_ROOM,
  PROTOCOL_VERSION,
  TICK_RATE,
  parseServerMessage,
  type ServerMessage,
} from '@world/shared';
import {
  CLOSE_BAD_HELLO,
  CLOSE_FLOOD,
  CLOSE_HELLO_TIMEOUT,
  CLOSE_NO_ROOM,
  CLOSE_OUT_OF_SEQUENCE,
  CLOSE_ROOM_FULL,
  CLOSE_ROOM_TAKEN,
  CLOSE_TRY_AGAIN_LATER,
  MAX_PAYLOAD_BYTES,
  startServer,
  type ServerOptions,
  type WorldServer,
} from './server.ts';

type Message<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>;

interface ClientOptions {
  autoPong?: boolean;
  headers?: Record<string, string>;
}

class TestClient {
  readonly ws: WebSocket;
  readonly messages: ServerMessage[] = [];
  closeCode: number | null = null;
  private waiters: (() => void)[] = [];

  constructor(port: number, options: ClientOptions = {}) {
    this.ws = new WebSocket(`ws://127.0.0.1:${port}`, {
      autoPong: options.autoPong ?? true,
      ...(options.headers ? { headers: options.headers } : {}),
    });
    this.ws.on('message', (data: Buffer) => {
      const message = parseServerMessage(data.toString());
      if (message) this.messages.push(message);
      this.notify();
    });
    this.ws.on('close', (code: number) => {
      this.closeCode = code;
      this.notify();
    });
  }

  private notify(): void {
    const waiters = this.waiters;
    this.waiters = [];
    for (const w of waiters) w();
  }

  opened(): Promise<void> {
    if (this.ws.readyState === WebSocket.OPEN) return Promise.resolve();
    return new Promise((resolve) => this.ws.once('open', () => resolve()));
  }

  send(message: unknown): void {
    this.ws.send(typeof message === 'string' ? message : JSON.stringify(message));
  }

  async waitFor<T>(check: () => T | undefined | null | false, timeoutMs = 2000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const result = check();
      if (result) return result;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('timed out waiting for condition');
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, remaining);
        this.waiters.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  waitForMessage<T extends ServerMessage['t']>(
    type: T,
    where: (m: Message<T>) => boolean = () => true,
  ): Promise<Message<T>> {
    return this.waitFor(() =>
      this.messages.find((m): m is Message<T> => m.t === type && where(m as Message<T>)),
    );
  }

  waitForClose(): Promise<number> {
    return this.waitFor(() => this.closeCode ?? undefined);
  }

  async join(name: string, room = 'lobby', extra: object = {}): Promise<Message<'welcome'>> {
    await this.opened();
    this.send({ t: 'hello', v: PROTOCOL_VERSION, name, room, ...extra });
    return this.waitForMessage('welcome');
  }

  /** Say hello and expect to be turned away with `code`; returns the close code. */
  async refused(
    hello: { name: string; room: string; intent?: 'start' | 'join' },
    code: string,
  ): Promise<number> {
    await this.opened();
    this.send({ t: 'hello', v: PROTOCOL_VERSION, ...hello });
    expect((await this.waitForMessage('error')).code).toBe(code);
    return this.waitForClose();
  }

  latestSnapshot(): Message<'snap'> | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i]!;
      if (m.t === 'snap') return m;
    }
    return undefined;
  }
}

let server: WorldServer;
const clients: TestClient[] = [];

function client(options?: ClientOptions): TestClient {
  const c = new TestClient(server.port, options);
  clients.push(c);
  return c;
}

/**
 * Swap the server for one with `options`, for the few tests about timeouts. Every other test runs
 * with the real ones: under a 200 ms heartbeat, a stall of the worker just after a ping (a busy
 * machine, garbage collection) lets the next heartbeat come round before the pong is read, and it
 * drops a perfectly live client.
 */
async function restartWith(options: Partial<ServerOptions>): Promise<void> {
  await server.close();
  server = await startServer({ port: 0, host: '127.0.0.1', ...options });
}

beforeEach(async () => {
  server = await startServer({ port: 0, host: '127.0.0.1' });
});

afterEach(async () => {
  for (const c of clients.splice(0)) c.ws.terminate();
  await server.close();
});

describe('room server', () => {
  it('welcomes a player and lets two players see each other', async () => {
    const a = client();
    const welcomeA = await a.join('Alice');
    expect(welcomeA.room).toBe('lobby');
    expect(welcomeA.players.map((p) => p.name)).toEqual(['Alice']);

    const b = client();
    const welcomeB = await b.join('Bob');
    expect(welcomeB.players.map((p) => p.name).sort()).toEqual(['Alice', 'Bob']);
    await a.waitForMessage('join', (m) => m.player.id === welcomeB.id);

    const snap = await b.waitFor(() => {
      const s = b.latestSnapshot();
      return s && s.players.length === 2 ? s : undefined;
    });
    expect(snap.players.map((p) => p.id).sort()).toEqual([welcomeA.id, welcomeB.id].sort());
  });

  it('moves a player from their inputs and acknowledges them', async () => {
    const a = client();
    const welcome = await a.join('Walker');
    // Strafe along the open aisle by the dining room doors.
    const startX = welcome.self.x;
    // Half a second of inputs.
    const count = TICK_RATE / 2;
    for (let seq = 0; seq < count; seq++)
      a.send({ t: 'input', seq, keys: Keys.Left, yaw: 0, pitch: 0 });
    const snap = await a.waitFor(() => {
      const me = a.latestSnapshot()?.players.find((p) => p.id === welcome.id);
      return me && me.ack === count - 1 ? me : undefined;
    });
    expect(snap.x).toBeLessThan(startX - 1);
  });

  it('ends a connection whose inputs skip ahead, before its cooldowns can be skipped', async () => {
    const watcher = client();
    await watcher.join('Watcher');
    const cheater = client();
    const welcome = await cheater.join('Cheater');
    // Every input a cooldown's worth past the last, as if the knife were ready each time.
    for (let i = 0; i < 10; i++) {
      const seq = 5000 + i * KNIFE_COOLDOWN_INPUTS;
      cheater.send({ t: 'input', seq, keys: Keys.Armed | Keys.Throw, yaw: 0, pitch: 0 });
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
    const knives = watcher.messages.filter((m) => m.t === 'knife' && m.from === welcome.id);
    expect(knives.length).toBeLessThanOrEqual(1);
    expect(cheater.closeCode).toBe(CLOSE_OUT_OF_SEQUENCE);
    expect(server.rooms.get('lobby')?.players.has(welcome.id)).toBe(false);
  });

  it('ends a connection that sends an input again, or an older one', async () => {
    const a = client();
    await a.join('Echo');
    a.send({ t: 'input', seq: 7, keys: 0, yaw: 0, pitch: 0 });
    a.send({ t: 'input', seq: 8, keys: 0, yaw: 0, pitch: 0 });
    a.send({ t: 'input', seq: 8, keys: 0, yaw: 0, pitch: 0 });
    expect(await a.waitForClose()).toBe(CLOSE_OUT_OF_SEQUENCE);
  });

  it('takes everything a stalled connection sent at once when it recovers', async () => {
    const a = client();
    const welcome = await a.join('Tunnel');
    // Five seconds of inputs and pings, the longest a client waits on a silent server before it
    // reconnects, held up on the way and arriving together; numbered on from a solo stretch.
    const first = 1234;
    const count = 5 * TICK_RATE;
    for (let i = 0; i < count; i++) {
      if (i % TICK_RATE === 0) a.send({ t: 'ping', id: i });
      a.send({ t: 'input', seq: first + i, keys: Keys.Left, yaw: 0, pitch: 0 });
    }
    await a.waitFor(() => {
      const me = a.latestSnapshot()?.players.find((p) => p.id === welcome.id);
      return (me && me.ack === first + count - 1) || a.closeCode !== null;
    });
    expect(a.closeCode).toBeNull();
  });

  it('broadcasts sanitized chat to the room, including the sender', async () => {
    const a = client();
    const b = client();
    const welcomeA = await a.join('Alice');
    await b.join('Bob');
    a.send({ t: 'chat', text: `  <b>hi</b>\u0000 ${'x'.repeat(300)}` });
    const received = await b.waitForMessage('chat');
    expect(received.id).toBe(welcomeA.id);
    expect(received.name).toBe('Alice');
    expect(received.text.startsWith('<b>hi</b> ')).toBe(true);
    expect(received.text.length).toBe(CHAT_MAX_LENGTH);
    await a.waitForMessage('chat');
  });

  it('tells the room of a few changes of prefs at once, and of a flood only now and then', async () => {
    const a = client();
    const b = client();
    const welcome = await a.join('Picky', 'tasting');
    await b.join('Watcher', 'tasting');
    const fromA = () => b.messages.filter((m) => m.t === 'prefs' && m.id === welcome.id);
    // A few changes of mind, as a visitor makes them: each passed on at once.
    for (let i = 0; i < 4; i++) a.send({ t: 'prefs', prefs: { chef: i % 2 === 1 } });
    await b.waitFor(() => fromA().length === 4);
    // Flicking through settings as fast as messages go: far fewer reach everyone else...
    for (let i = 0; i < 60; i++) a.send({ t: 'prefs', prefs: { chef: i % 2 === 1 } });
    a.send({ t: 'prefs', prefs: { chef: false, skin: 'karambit' } });
    // Reaches the watcher after everything the room passed on before it.
    a.send({ t: 'chat', text: 'done' });
    await b.waitForMessage('chat');
    expect(fromA().length).toBeLessThan(4 + 20);
    // ...but the last word always does, and nobody is cut off for it.
    const last = { t: 'prefs', id: welcome.id, prefs: { chef: false, skin: 'karambit' } };
    await b.waitFor(() => JSON.stringify(fromA().at(-1)) === JSON.stringify(last), 3000);
    expect(server.rooms.get('tasting')!.players.get(welcome.id)!.prefs).toEqual(last.prefs);
    expect(a.closeCode).toBeNull();
  });

  it('keeps private rooms isolated', async () => {
    const a = client();
    const b = client();
    const c = client();
    await a.join('Alice', 'Secret Base');
    const welcomeB = await b.join('Bob', 'lobby');
    const welcomeC = await c.join('Cara', 'secret-base');
    expect(welcomeC.room).toBe('secret-base');
    expect(welcomeC.players.map((p) => p.name).sort()).toEqual(['Alice', 'Cara']);
    await a.waitForMessage('join', (m) => m.player.name === 'Cara');
    c.send({ t: 'chat', text: 'psst' });
    await a.waitForMessage('chat');
    await new Promise((r) => setTimeout(r, 150));
    expect(b.messages.some((m) => m.t === 'chat' || m.t === 'join')).toBe(false);
    expect(b.latestSnapshot()?.players.map((p) => p.id)).toEqual([welcomeB.id]);
  });

  it('broadcasts leave when a player disconnects and forgets empty rooms', async () => {
    const a = client();
    const b = client();
    const welcomeA = await a.join('Alice', 'tmp');
    await b.join('Bob', 'tmp');
    a.ws.close();
    await b.waitForMessage('leave', (m) => m.id === welcomeA.id);
    b.ws.close();
    await b.waitForClose();
    await b.waitFor(() => !server.rooms.has('tmp'));
  });

  it('rejects the player after the room is full', async () => {
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM; i++) await client().join(`P${i}`, 'packed');
    const extra = client();
    await extra.opened();
    extra.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Late', room: 'packed' });
    const error = await extra.waitForMessage('error');
    expect(error.code).toBe('room_full');
    expect(await extra.waitForClose()).toBe(CLOSE_ROOM_FULL);
    expect(server.rooms.get('packed')?.players.size).toBe(MAX_PLAYERS_PER_ROOM);
  });

  it('starts a party only on a code nobody is using', async () => {
    const host = client();
    const welcome = await host.join('Host', 'Friday Service', { intent: 'start' });
    expect(welcome.room).toBe('friday-service');
    const late = client();
    expect(
      await late.refused({ name: 'Late', room: 'friday-service', intent: 'start' }, 'room_taken'),
    ).toBe(CLOSE_ROOM_TAKEN);
    expect(server.rooms.get('friday-service')?.players.size).toBe(1);
    // Joining it, or following a link (no intent), still works.
    await client().join('Guest', 'friday-service', { intent: 'join' });
    await client().join('Linked', 'friday-service');
    expect(server.rooms.get('friday-service')?.players.size).toBe(3);
  });

  it('joins a party only if somebody is there', async () => {
    const lost = client();
    expect(
      await lost.refused({ name: 'Lost', room: 'nobody-here', intent: 'join' }, 'no_room'),
    ).toBe(CLOSE_NO_ROOM);
    expect(server.rooms.has('nobody-here')).toBe(false);
  });

  it('always lets anyone into the lobby, whatever the intent', async () => {
    await client().join('First', 'lobby', { intent: 'join' });
    await client().join('Second', 'lobby', { intent: 'start' });
    expect(server.rooms.get('lobby')?.players.size).toBe(2);
  });

  it('rejects clients on a different protocol version', async () => {
    const a = client();
    await a.opened();
    a.send({ t: 'hello', v: PROTOCOL_VERSION + 1, name: 'Old', room: 'lobby' });
    expect((await a.waitForMessage('error')).code).toBe('version');
    expect(await a.waitForClose()).toBe(CLOSE_BAD_HELLO);
  });

  it('ignores everything a rejected socket sends while it closes', async () => {
    const watcher = client();
    await watcher.join('Watcher', 'r');
    const ghost = client();
    await ghost.opened();
    ghost.send({ t: 'hello', v: PROTOCOL_VERSION + 1, name: 'Ghost', room: 'r' });
    ghost.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Ghost', room: 'r' });
    await ghost.waitForClose();
    expect(ghost.messages.some((m) => m.t === 'welcome')).toBe(false);
    expect(server.rooms.get('r')?.players.size).toBe(1);
    expect(watcher.messages.some((m) => m.t === 'join')).toBe(false);
  });

  it('refuses a hello whose spawn hint is turned past any real turn', async () => {
    // Refused by ignoring it, so the connection ends when its hello is overdue.
    await restartWith({ helloTimeoutMs: 300 });
    const a = client();
    await a.opened();
    const spawn = { x: 0, z: 5.6, yaw: 1.7e308 };
    a.send({ t: 'hello', v: PROTOCOL_VERSION, name: 'Spinner', room: 'lobby', spawn });
    expect(await a.waitForClose()).toBe(CLOSE_HELLO_TIMEOUT);
    expect(a.messages.some((m) => m.t === 'welcome')).toBe(false);
    // A hint as a real client sends it, its turn wrapped or not, is welcome, facing the same way.
    const b = client();
    const welcome = await b.join('Turner', 'lobby', { spawn: { ...spawn, yaw: 4 * Math.PI + 1 } });
    expect(welcome.self.yaw).toBeCloseTo(1, 3);
  });

  it('gives duplicate names a number', async () => {
    await client().join('Otter');
    const second = await client().join('otter');
    expect(second.players.map((p) => p.name).sort()).toEqual(['Otter', 'otter 2']);
  });

  it('limits connections per IP', async () => {
    await server.close();
    server = await startServer({ port: 0, host: '127.0.0.1', maxConnectionsPerIp: 2 });
    await client().join('One');
    await client().join('Two');
    const third = client();
    expect(await third.waitForClose()).toBe(CLOSE_TRY_AGAIN_LATER);
  });

  it('behind CloudFront, counts the address it saw, not one a visitor wrote in', async () => {
    await server.close();
    server = await startServer({
      port: 0,
      host: '127.0.0.1',
      trustProxy: true,
      maxConnectionsPerIp: 1,
    });
    // CloudFront appends the address it got the request from to whatever the visitor sent.
    const via = (sent: string, seen: string) => ({
      headers: { 'x-forwarded-for': sent ? `${sent}, ${seen}` : seen },
    });
    await client(via('', '198.51.100.7')).join('One');
    const spoofed = client(via('203.0.113.1', '198.51.100.7'));
    expect(await spoofed.waitForClose()).toBe(CLOSE_TRY_AGAIN_LATER);
    const another = client(via('203.0.113.2, 203.0.113.3', '198.51.100.7'));
    expect(await another.waitForClose()).toBe(CLOSE_TRY_AGAIN_LATER);
    // Somebody else really is somebody else, whatever they wrote in.
    expect((await client(via('198.51.100.7', '198.51.100.8')).join('Two')).room).toBe('lobby');
  });

  it('survives a socket it turned away sending a frame over the size limit', async () => {
    await server.close();
    server = await startServer({ port: 0, host: '127.0.0.1', maxConnectionsPerIp: 1 });
    // An error event nobody listens for is thrown, and would take the whole process down.
    const uncaught: unknown[] = [];
    const onUncaught = (error: unknown): void => void uncaught.push(error);
    process.on('uncaughtException', onUncaught);
    try {
      const a = client();
      await a.join('One');
      const turnedAway = client();
      // Sent as soon as the socket opens, while the server is already closing it.
      turnedAway.ws.once('open', () => turnedAway.ws.send('x'.repeat(MAX_PAYLOAD_BYTES + 3000)));
      await turnedAway.waitForClose();
      a.send({ t: 'ping', id: 1 });
      await a.waitForMessage('pong');
      expect(uncaught).toEqual([]);
    } finally {
      process.off('uncaughtException', onUncaught);
    }
  });

  it('drops invalid messages without disconnecting', async () => {
    const a = client();
    const welcome = await a.join('Alice');
    a.send('not json');
    a.send({ t: 'input', seq: 0, keys: 12345, yaw: 0, pitch: 0 });
    a.send({ t: 'teleport', x: 0, y: 100, z: 0 });
    a.ws.send(Buffer.from([1, 2, 3]), { binary: true });
    a.send({ t: 'ping', id: 7 });
    expect((await a.waitForMessage('pong')).id).toBe(7);
    const me = await a.waitFor(() => a.latestSnapshot()?.players.find((p) => p.id === welcome.id));
    expect(me.ack).toBe(-1);
    expect(a.closeCode).toBeNull();
  });

  it('disconnects a client that floods messages', async () => {
    const a = client();
    await a.join('Flooder');
    for (let i = 0; i < 500; i++) a.send({ t: 'ping', id: i });
    expect(await a.waitForClose()).toBe(CLOSE_FLOOD);
  });

  it('closes connections that never say hello', async () => {
    await restartWith({ helloTimeoutMs: 300 });
    const a = client();
    await a.opened();
    expect(await a.waitForClose()).toBe(CLOSE_HELLO_TIMEOUT);
  });

  it('drops connections that stop answering heartbeats', async () => {
    await restartWith({ heartbeatMs: 200 });
    const a = client();
    const b = client({ autoPong: false });
    await a.join('Alive');
    const welcomeB = await b.join('Ghost');
    await a.waitForMessage('leave', (m) => m.id === welcomeB.id);
  });

  it('keeps a connection that answered in time while the server itself was stalled', async () => {
    await restartWith({ heartbeatMs: 200 });
    const a = client();
    await a.join('Patient');
    // Its pong is on its way when the process stops for a few heartbeats, as in a long GC pause
    // or on a busy host: the pong waits unread while the heartbeat falls behind.
    a.ws.once('ping', () => {
      const until = Date.now() + 700;
      while (Date.now() < until) {
        // The whole process, server included, waits.
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(a.ws.readyState).toBe(WebSocket.OPEN);
  });

  it('serves the lobby player count over HTTP', async () => {
    await client().join('Alice');
    await client().join('Bob');
    const response = await fetch(`http://127.0.0.1:${server.port}/rooms/LOBBY`);
    expect(response.headers.get('access-control-allow-origin')).toBe('*');
    expect(await response.json()).toEqual({ room: 'lobby', players: 2, max: MAX_PLAYERS_PER_ROOM });
  });

  it('serves its HTTP routes under a base path too', async () => {
    await server.close();
    server = await startServer({ port: 0, host: '127.0.0.1', basePath: '/ws' });
    const prefixed = await fetch(`http://127.0.0.1:${server.port}/ws/rooms/lobby`);
    expect(await prefixed.json()).toMatchObject({ room: 'lobby', players: 0 });
    expect((await fetch(`http://127.0.0.1:${server.port}/ws/health`)).status).toBe(200);
    // WebSocket upgrades on the prefixed path work as usual.
    expect((await client().join('Pathfinder')).room).toBe('lobby');
  });

  it('does not reveal how many players are in private rooms', async () => {
    await client().join('Alice', 'hideout');
    const response = await fetch(`http://127.0.0.1:${server.port}/rooms/hideout`);
    expect(response.status).toBe(404);
  });

  it('survives malformed HTTP requests', async () => {
    const bad = await fetch(`http://127.0.0.1:${server.port}/rooms/%E0%A4%A`);
    expect(bad.status).toBe(400);
    const health = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(health.status).toBe(200);
  });
});

describe('Chef Skinner in the lobby', () => {
  beforeEach(async () => {
    await server.close();
    server = await startServer({ port: 0, host: '127.0.0.1', chef: true });
  });

  it('is there to welcome the first visitor, walking about, but only in the lobby', async () => {
    const a = client();
    const welcome = await a.join('Alice');
    const chef = welcome.players.find((p) => p.name === 'Chef Skinner');
    expect(chef).toBeDefined();
    const start = await a.waitFor(() => a.latestSnapshot()?.players.find((p) => p.id === chef!.id));
    await a.waitFor(() => {
      const now = a.latestSnapshot()?.players.find((p) => p.id === chef!.id);
      return now && Math.hypot(now.x - start.x, now.z - start.z) > 1;
    }, 5000);
    // Visitors are counted without him, and private rooms do not get one.
    const response = await fetch(`http://127.0.0.1:${server.port}/rooms/lobby`);
    expect(((await response.json()) as { players: number }).players).toBe(1);
    const hideout = await client().join('Bob', 'hideout');
    expect(hideout.players.map((p) => p.name)).toEqual(['Bob']);
  });

  it("takes one of the lobby's places, so the count says how many visitors fit", async () => {
    const lobby = async () =>
      (await (await fetch(`http://127.0.0.1:${server.port}/rooms/lobby`)).json()) as {
        players: number;
        max: number;
      };
    // Before anyone is there, and with them.
    expect(await lobby()).toEqual({ room: 'lobby', players: 0, max: MAX_PLAYERS_PER_ROOM - 1 });
    for (let i = 0; i < MAX_PLAYERS_PER_ROOM - 1; i++) await client().join(`P${i}`);
    const { players, max } = await lobby();
    expect(players).toBe(max);
    expect(await client().refused({ name: 'Late', room: 'lobby' }, 'room_full')).toBe(
      CLOSE_ROOM_FULL,
    );
  });

  it('is marked as the resident, and nobody else is', async () => {
    const welcome = await client().join('Alice');
    const chef = welcome.players.find((p) => p.name === 'Chef Skinner')!;
    expect(chef.resident).toBe(true);
    expect(welcome.players.find((p) => p.id === welcome.id)).not.toHaveProperty('resident');
  });

  it("keeps each visitor's choice about him, from the hello and whenever it changes", async () => {
    const a = client();
    const welcome = await a.join('Alice', 'lobby', { prefs: { chef: false } });
    const prefs = () => server.rooms.get('lobby')!.players.get(welcome.id)!.prefs;
    expect(prefs()).toEqual({ chef: false });
    // Everyone knows, so every screen replays his knives as the server flies them.
    const b = client();
    const bWelcome = await b.join('Bob');
    const alice = bWelcome.players.find((p) => p.id === welcome.id)!;
    expect(alice.prefs).toEqual({ chef: false });
    a.send({ t: 'prefs', prefs: { chef: true } });
    await a.waitFor(() => prefs().chef);
    const told = await b.waitForMessage('prefs');
    expect(told).toEqual({ t: 'prefs', id: welcome.id, prefs: { chef: true } });
    // Nonsense is dropped, and the choice stands.
    a.send({ t: 'prefs', prefs: { chef: 'off' } });
    a.send({ t: 'prefs' });
    a.send({ t: 'ping', id: 1 });
    await a.waitForMessage('pong');
    expect(prefs()).toEqual({ chef: true });
    expect(a.closeCode).toBeNull();
    // Saying the same again is not news.
    a.send({ t: 'prefs', prefs: { chef: true } });
    a.send({ t: 'ping', id: 2 });
    await a.waitForMessage('pong', (m) => m.id === 2);
    expect(b.messages.filter((m) => m.t === 'prefs')).toHaveLength(1);
    // A hello without prefs gets him as he comes.
    expect(server.rooms.get('lobby')!.players.get(bWelcome.id)!.prefs).toEqual({ chef: true });
  });

  it('takes the choice in a private room too, where he is not', async () => {
    const a = client();
    const welcome = await a.join('Alice', 'hideout', { prefs: { chef: false } });
    a.send({ t: 'prefs', prefs: { chef: true } });
    await a.waitFor(() => server.rooms.get('hideout')!.players.get(welcome.id)!.prefs.chef);
    a.send({ t: 'chat', text: 'still here' });
    expect((await a.waitForMessage('chat')).text).toBe('still here');
  });

  it('leaves with the last visitor, and is back for the next one', async () => {
    const a = client();
    await a.join('Alice');
    a.ws.close();
    await a.waitForClose();
    await a.waitFor(() => !server.rooms.has('lobby'));
    const welcome = await client().join('Bob');
    expect(welcome.players.map((p) => p.name).sort()).toEqual(['Bob', 'Chef Skinner']);
  });
});
