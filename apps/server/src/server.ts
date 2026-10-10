import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  DEFAULT_ROOM,
  MAX_PLAYERS_PER_ROOM,
  PLAY_BOUNDS,
  PROTOCOL_VERSION,
  TICK_MS,
  TICK_RATE,
  encode,
  normalizeRoomCode,
  parseClientMessage,
  sanitizeChat,
  sanitizeName,
  type ClientMessage,
  type Prefs,
  type ServerMessage,
} from '@world/shared';
import { StrikeCounter, TokenBucket } from './rateLimit.ts';
import { WalkInChef, type Chef } from './chef.ts';
import { Room, type RoomPlayer } from './room.ts';

export interface ServerOptions {
  port: number;
  host?: string;
  tickMs?: number;
  heartbeatMs?: number;
  helloTimeoutMs?: number;
  /** Total simultaneous sockets. */
  maxConnections?: number;
  maxConnectionsPerIp?: number;
  /** If set, only pages served from these origins may connect (e.g. `https://example.com`). */
  allowedOrigins?: readonly string[];
  /**
   * Behind exactly one reverse proxy (CloudFront), which alone can reach the server and appends the
   * address it got each request from to `x-forwarded-for`: take the client's address from there.
   */
  trustProxy?: boolean;
  /** Path prefix in front of the HTTP routes, e.g. `/ws` when a CDN routes `/ws*` here. */
  basePath?: string;
  /**
   * Lock Chef Skinner in every room's walk-in, to come out when its door bursts (see chef.ts). Each
   * room keeps one of its places for him all along, so it takes one visitor fewer.
   */
  chef?: boolean;
  log?: (message: string) => void;
}

export interface WorldServer {
  readonly port: number;
  readonly rooms: ReadonlyMap<string, Room>;
  /** Chef Skinner in the room with this code, if he is out of its walk-in (tests watch him). */
  chef(room: string): Chef | undefined;
  close(): Promise<void>;
}

/** Largest message a client may send. Real messages are well under 200 bytes. */
export const MAX_PAYLOAD_BYTES = 2048;

// Close codes. 1008 is the standard "policy violation"; 4xxx are application specific.
export const CLOSE_FLOOD = 1008;
export const CLOSE_ROOM_FULL = 4001;
export const CLOSE_BAD_HELLO = 4002;
export const CLOSE_HELLO_TIMEOUT = 4003;
export const CLOSE_ROOM_TAKEN = 4004;
export const CLOSE_NO_ROOM = 4005;
/** An input that is not the one after the last: only a modified client sends one. */
export const CLOSE_OUT_OF_SEQUENCE = 4006;
export const CLOSE_TRY_AGAIN_LATER = 1013;

/**
 * Messages a socket may send at once. A client sends an input every tick, a ping a second, and chat
 * or prefs now and then. A connection that stalls delivers everything it sent meanwhile at once when
 * it recovers, and a client waits up to 5 s on a silent server before it reconnects, so 6 s of
 * inputs must pass at once: inputs are numbered one after another, and losing one to this limit
 * would end the connection (`CLOSE_OUT_OF_SEQUENCE`).
 */
export const MESSAGE_BURST = 6 * TICK_RATE;
/**
 * Messages a socket may send per second, sustained: a little over the one input a tick a client
 * sends, so one sending inputs faster than there are ticks, to count its cooldowns down sooner,
 * gains next to nothing (the room still simulates one a tick), and is cut off once its burst is
 * spent.
 */
export const MESSAGES_PER_SECOND = 1.1 * TICK_RATE;

/**
 * Changes of prefs a visitor may make at once, and per second after that, before the room hears of
 * them only so often. Each is passed on to everyone in the room, so a flood of them would multiply
 * across every socket; past the limit the newest waits its turn, replacing any before it, so the
 * room always ends up with the visitor's last choice and a few quick changes of mind pass at once.
 */
export const PREFS_BURST = 8;
export const PREFS_PER_SECOND = 2;

/** A client that is this far behind on reading snapshots is dropped instead of buffered forever. */
export const MAX_BUFFERED_BYTES = 256 * 1024;
/** After asking a socket to close, stop waiting for its handshake after this long. */
const CLOSE_GRACE_MS = 1000;

interface Connection {
  readonly ws: WebSocket;
  readonly ip: string;
  alive: boolean;
  /** Set as soon as we decide to drop the socket; nothing it sends is processed after that. */
  closing: boolean;
  room: Room | null;
  player: RoomPlayer | null;
  readonly messages: TokenBucket;
  readonly chat: TokenBucket;
  /** Changes of prefs passed on to the room; any more in between are folded into the next. */
  readonly prefs: TokenBucket;
  /** The newest change of prefs not yet passed on. */
  pendingPrefs: Prefs | null;
  /** Set while `pendingPrefs` waits for the bucket. */
  prefsTimer: NodeJS.Timeout | null;
  readonly strikes: StrikeCounter;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function rawToString(data: RawData): string {
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  return Buffer.from(data).toString('utf8');
}

/**
 * Where a socket comes from, for capping connections per address. Behind the proxy that is the last
 * entry of `x-forwarded-for`: CloudFront appends the address it got the request from to whatever
 * the visitor sent, so every entry before it is the visitor's to write. (Node joins a repeated
 * header into one, so a visitor sending two changes nothing.)
 */
function clientAddress(req: IncomingMessage, trustProxy: boolean): string {
  const direct = req.socket.remoteAddress ?? 'unknown';
  if (!trustProxy) return direct;
  const forwarded = req.headers['x-forwarded-for'];
  const last = typeof forwarded === 'string' ? forwarded.split(',').at(-1)?.trim() : undefined;
  return last || direct;
}

function clampSpawn(spawn: { x: number; z: number; yaw: number }): {
  x: number;
  z: number;
  yaw: number;
} {
  // The room checks the spot is somewhere a player may stand (the cooler only once it is open).
  const x = Math.min(PLAY_BOUNDS.maxX, Math.max(PLAY_BOUNDS.minX, spawn.x));
  const z = Math.min(PLAY_BOUNDS.maxZ, Math.max(PLAY_BOUNDS.minZ, spawn.z));
  return { x, z, yaw: spawn.yaw };
}

export function startServer(options: ServerOptions): Promise<WorldServer> {
  const tickMs = options.tickMs ?? TICK_MS;
  const heartbeatMs = options.heartbeatMs ?? 10_000;
  const helloTimeoutMs = options.helloTimeoutMs ?? 10_000;
  const log = options.log ?? (() => {});
  const rooms = new Map<string, Room>();
  /** Chef Skinner in each room's walk-in, and out of it once its door has burst. */
  const chefs = new Map<Room, WalkInChef>();
  const connections = new Set<Connection>();
  let nextPlayerId = 1;
  /**
   * Visitors a room takes: all its places, but for the one it keeps for Chef Skinner, who may come
   * out of the walk-in at any time.
   */
  const visitorCapacity = MAX_PLAYERS_PER_ROOM - (options.chef ? 1 : 0);

  const http: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const basePath = options.basePath ?? '';
    const pathname =
      basePath && (url.pathname === basePath || url.pathname.startsWith(`${basePath}/`))
        ? url.pathname.slice(basePath.length) || '/'
        : url.pathname;
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET',
      });
      res.end();
      return;
    }
    if (req.method !== 'GET') {
      sendJson(res, 405, { error: 'method not allowed' });
      return;
    }
    if (pathname === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }
    const match = /^\/rooms\/([^/]{1,64})$/.exec(pathname);
    // Only the public lobby's count is published; private room codes stay private.
    if (match) {
      let raw: string;
      try {
        raw = decodeURIComponent(match[1]!);
      } catch {
        sendJson(res, 400, { error: 'bad room code' });
        return;
      }
      const code = normalizeRoomCode(raw);
      if (code !== DEFAULT_ROOM) {
        sendJson(res, 404, { error: 'not found' });
        return;
      }
      sendJson(res, 200, {
        room: code,
        // Visitors only, and how many fit: Chef Skinner is a secret, though his place is kept.
        players: rooms.get(code)?.visitors ?? 0,
        max: visitorCapacity,
      });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  });

  const wss = new WebSocketServer({ server: http, maxPayload: MAX_PAYLOAD_BYTES });

  const sendRaw = (conn: Connection, data: string): void => {
    if (conn.closing || conn.ws.readyState !== conn.ws.OPEN) return;
    if (conn.ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      log(`dropping slow client${conn.player ? ` #${conn.player.id}` : ''}`);
      drop(conn, CLOSE_FLOOD, 'too slow');
      return;
    }
    conn.ws.send(data);
  };

  const send = (conn: Connection, message: ServerMessage): void => sendRaw(conn, encode(message));

  /** Stop processing a socket right away, leave its room, and close it (forcefully if needed). */
  const drop = (conn: Connection, code: number, reason: string): void => {
    if (conn.closing) return;
    conn.closing = true;
    leave(conn);
    conn.ws.close(code, reason);
    setTimeout(() => conn.ws.terminate(), CLOSE_GRACE_MS).unref();
  };

  const leave = (conn: Connection): void => {
    const { room, player } = conn;
    if (!room || !player) return;
    conn.room = null;
    conn.player = null;
    room.remove(player.id);
    log(`${player.name} (#${player.id}) left ${room.code} (${room.visitors} left)`);
    if (room.isEmpty) {
      rooms.delete(room.code);
      chefs.delete(room);
    }
  };

  const handleHello = (conn: Connection, message: Extract<ClientMessage, { t: 'hello' }>): void => {
    if (conn.player) return;
    if (message.v !== PROTOCOL_VERSION) {
      send(conn, { t: 'error', code: 'version', message: 'Please reload the page to update.' });
      drop(conn, CLOSE_BAD_HELLO, 'version');
      return;
    }
    const code = normalizeRoomCode(message.room);
    let room = rooms.get(code);
    // Starting a party needs a code nobody is using, joining one needs somebody there. Without an
    // intent (links, reconnects) the room is joined or made, and the lobby is open to everyone.
    if (code !== DEFAULT_ROOM && message.intent === 'start' && room) {
      send(conn, { t: 'error', code: 'room_taken', message: `Room "${code}" is already in use.` });
      drop(conn, CLOSE_ROOM_TAKEN, 'room taken');
      return;
    }
    if (code !== DEFAULT_ROOM && message.intent === 'join' && !room) {
      send(conn, { t: 'error', code: 'no_room', message: `Nobody is in room "${code}".` });
      drop(conn, CLOSE_NO_ROOM, 'no such room');
      return;
    }
    if (room && room.visitors >= visitorCapacity) {
      send(conn, { t: 'error', code: 'room_full', message: `Room "${code}" is full.` });
      drop(conn, CLOSE_ROOM_FULL, 'room full');
      return;
    }
    if (!room) {
      room = new Room(code);
      rooms.set(code, room);
      if (options.chef) chefs.set(room, new WalkInChef(room, () => nextPlayerId++));
    }
    const name = room.uniqueName(sanitizeName(message.name) || 'Guest');
    const player = room.add({
      id: nextPlayerId++,
      name,
      spawn: message.spawn ? clampSpawn(message.spawn) : undefined,
      prefs: message.prefs,
      send: (data) => sendRaw(conn, data),
    });
    conn.room = room;
    conn.player = player;
    send(conn, {
      t: 'welcome',
      v: PROTOCOL_VERSION,
      id: player.id,
      room: code,
      tick: room.tick,
      players: room.playerList(),
      self: room.snapshotOf(player),
      knives: room.stuckKnives(),
      cooler: room.coolerState(),
    });
    log(`${name} (#${player.id}) joined ${code} (${room.visitors} visitors)`);
  };

  /** Tell the room of the connection's newest prefs now, or as soon as their bucket allows. */
  const passOnPrefs = (conn: Connection): void => {
    conn.prefsTimer = null;
    const { room, player, pendingPrefs } = conn;
    if (conn.closing || !room || !player || !pendingPrefs) return;
    const wait = conn.prefs.wait();
    if (wait > 0) {
      conn.prefsTimer = setTimeout(() => passOnPrefs(conn), wait);
      conn.prefsTimer.unref();
      return;
    }
    conn.prefs.take();
    conn.pendingPrefs = null;
    room.setPrefs(player, pendingPrefs);
  };

  const handleMessage = (conn: Connection, message: ClientMessage): void => {
    if (message.t === 'hello') {
      handleHello(conn, message);
      return;
    }
    if (message.t === 'ping') {
      send(conn, { t: 'pong', id: message.id });
      return;
    }
    const { room, player } = conn;
    if (!room || !player) return;
    switch (message.t) {
      case 'input':
        if (!room.enqueueInput(player, message)) {
          log(`disconnecting #${player.id}: input ${message.seq} after ${player.received}`);
          drop(conn, CLOSE_OUT_OF_SEQUENCE, 'input out of sequence');
        }
        break;
      case 'prefs':
        conn.pendingPrefs = message.prefs;
        // Already waiting its turn: this one takes the place of the last.
        if (!conn.prefsTimer) passOnPrefs(conn);
        break;
      case 'chat': {
        if (!conn.chat.take()) return;
        const text = sanitizeChat(message.text);
        if (text) room.broadcast({ t: 'chat', id: player.id, name: player.name, text });
        break;
      }
    }
  };

  const maxConnections = options.maxConnections ?? 1000;
  const maxPerIp = options.maxConnectionsPerIp ?? 20;
  const perIp = new Map<string, number>();

  /**
   * Turn a socket away before it is a connection: say why, and stop waiting for its handshake after
   * the grace period, so sockets refused for being too many cannot pile up while they close.
   */
  const turnAway = (ws: WebSocket, code: number, reason: string): void => {
    ws.close(code, reason);
    setTimeout(() => ws.terminate(), CLOSE_GRACE_MS).unref();
  };

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // First, before anything can turn the socket away: a socket emits errors (an oversized or
    // malformed frame) even while it closes, and an error event nobody listens for is thrown, which
    // would take the whole server down. A close event follows, which does any cleanup.
    ws.on('error', () => {});
    const ip = clientAddress(req, options.trustProxy ?? false);
    const origin = req.headers.origin;
    if (options.allowedOrigins && (!origin || !options.allowedOrigins.includes(origin))) {
      turnAway(ws, CLOSE_FLOOD, 'origin not allowed');
      return;
    }
    if (connections.size >= maxConnections || (perIp.get(ip) ?? 0) >= maxPerIp) {
      turnAway(ws, CLOSE_TRY_AGAIN_LATER, 'too many connections');
      return;
    }
    perIp.set(ip, (perIp.get(ip) ?? 0) + 1);

    const conn: Connection = {
      ws,
      ip,
      alive: true,
      closing: false,
      room: null,
      player: null,
      messages: new TokenBucket(MESSAGE_BURST, MESSAGES_PER_SECOND),
      chat: new TokenBucket(4, 0.5),
      prefs: new TokenBucket(PREFS_BURST, PREFS_PER_SECOND),
      pendingPrefs: null,
      prefsTimer: null,
      strikes: new StrikeCounter(40, 10),
    };
    connections.add(conn);

    const helloTimer = setTimeout(() => {
      if (!conn.player) drop(conn, CLOSE_HELLO_TIMEOUT, 'hello timeout');
    }, helloTimeoutMs);

    const strike = (): void => {
      if (conn.strikes.add()) {
        log(`disconnecting flooder${conn.player ? ` #${conn.player.id}` : ''}`);
        send(conn, { t: 'error', code: 'rate_limited', message: 'Too many messages.' });
        drop(conn, CLOSE_FLOOD, 'rate limit');
      }
    };

    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('message', (data: RawData, isBinary: boolean) => {
      if (conn.closing) return;
      if (!conn.messages.take()) {
        strike();
        return;
      }
      const message = isBinary ? null : parseClientMessage(rawToString(data));
      if (!message) {
        strike();
        return;
      }
      handleMessage(conn, message);
    });
    ws.on('close', () => {
      clearTimeout(helloTimer);
      if (conn.prefsTimer) clearTimeout(conn.prefsTimer);
      connections.delete(conn);
      const count = (perIp.get(ip) ?? 1) - 1;
      if (count <= 0) perIp.delete(ip);
      else perIp.set(ip, count);
      leave(conn);
    });
  });

  // Drop connections that stopped answering pings (closed laptop lids, dead networks). A beat that
  // comes late means this process itself was held up (a long GC pause, a busy host), and the pongs
  // that came meanwhile are still unread, since timers run before sockets are read: it only pings.
  let lastBeat = performance.now();
  const heartbeat = setInterval(() => {
    const now = performance.now();
    const late = now - lastBeat > heartbeatMs * 1.5;
    lastBeat = now;
    for (const conn of connections) {
      if (!conn.alive && !late) {
        conn.ws.terminate();
        continue;
      }
      conn.alive = false;
      conn.ws.ping();
    }
  }, heartbeatMs);

  // Fixed-rate tick loop that corrects for timer drift.
  let nextTick = performance.now() + tickMs;
  let tickTimer: NodeJS.Timeout;
  const runTick = (): void => {
    const now = performance.now();
    // After a long stall (debugger, sleep), resynchronize instead of running a burst of ticks.
    if (now - nextTick > 1000) nextTick = now;
    nextTick += tickMs;
    tickTimer = setTimeout(runTick, Math.max(0, nextTick - performance.now()));
    for (const room of rooms.values()) {
      // One broken room must never stop the loop for everyone else.
      try {
        chefs.get(room)?.think();
        room.step();
      } catch (error) {
        log(`tick failed in room ${room.code}: ${String(error)}`);
      }
    }
  };
  tickTimer = setTimeout(runTick, tickMs);

  return new Promise((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port, options.host, () => {
      const port = (http.address() as AddressInfo).port;
      resolve({
        port,
        rooms,
        chef: (code) => {
          const room = rooms.get(code);
          return (room && chefs.get(room)?.chef) ?? undefined;
        },
        close: () =>
          new Promise<void>((done) => {
            clearInterval(heartbeat);
            clearTimeout(tickTimer);
            for (const conn of connections) conn.ws.terminate();
            wss.close(() => http.close(() => done()));
          }),
      });
    });
  });
}
