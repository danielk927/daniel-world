import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  DEFAULT_ROOM,
  MAX_PLAYERS_PER_ROOM,
  PLAY_HALF_X,
  PLAY_HALF_Z,
  PROTOCOL_VERSION,
  TICK_MS,
  TICK_RATE,
  encode,
  normalizeRoomCode,
  parseClientMessage,
  sanitizeChat,
  sanitizeName,
  type ClientMessage,
  type ServerMessage,
} from '@world/shared';
import { StrikeCounter, TokenBucket } from './rateLimit.ts';
import { Chef } from './chef.ts';
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
  /** Behind a reverse proxy (Fly.io, Railway), take the client IP from `x-forwarded-for`. */
  trustProxy?: boolean;
  /** Path prefix in front of the HTTP routes, e.g. `/ws` when a CDN routes `/ws*` here. */
  basePath?: string;
  /** Keep Chef Skinner in the public lobby whenever anyone is there (see chef.ts). */
  chef?: boolean;
  log?: (message: string) => void;
}

export interface WorldServer {
  readonly port: number;
  readonly rooms: ReadonlyMap<string, Room>;
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
export const CLOSE_TRY_AGAIN_LATER = 1013;

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

function clampSpawn(spawn: { x: number; z: number; yaw: number }): {
  x: number;
  z: number;
  yaw: number;
} {
  const x = Math.min(PLAY_HALF_X, Math.max(-PLAY_HALF_X, spawn.x));
  const z = Math.min(PLAY_HALF_Z, Math.max(-PLAY_HALF_Z, spawn.z));
  return { x, z, yaw: spawn.yaw };
}

export function startServer(options: ServerOptions): Promise<WorldServer> {
  const tickMs = options.tickMs ?? TICK_MS;
  const heartbeatMs = options.heartbeatMs ?? 10_000;
  const helloTimeoutMs = options.helloTimeoutMs ?? 10_000;
  const log = options.log ?? (() => {});
  const rooms = new Map<string, Room>();
  const chefs = new Map<Room, Chef>();
  const connections = new Set<Connection>();
  let nextPlayerId = 1;

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
        // Visitors only: Chef Skinner is always in, so he is not news.
        players: rooms.get(code)?.visitors ?? 0,
        max: MAX_PLAYERS_PER_ROOM,
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
    if (room?.isFull) {
      send(conn, { t: 'error', code: 'room_full', message: `Room "${code}" is full.` });
      drop(conn, CLOSE_ROOM_FULL, 'room full');
      return;
    }
    if (!room) {
      room = new Room(code);
      rooms.set(code, room);
      if (options.chef && code === DEFAULT_ROOM) addChef(room);
    }
    const name = room.uniqueName(sanitizeName(message.name) || 'Guest');
    const player = room.add({
      id: nextPlayerId++,
      name,
      spawn: message.spawn ? clampSpawn(message.spawn) : undefined,
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
    });
    log(`${name} (#${player.id}) joined ${code} (${room.visitors} visitors)`);
  };

  const addChef = (room: Room): void => {
    const chef = new Chef(room, nextPlayerId++);
    chefs.set(room, chef);
    room.onKnockout = (from, to) => {
      if (from === chef.player.id) chef.onKnockout(to);
      if (to === chef.player.id) chef.onKnockedOut();
    };
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
        room.enqueueInput(player, message);
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

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const forwarded = options.trustProxy ? req.headers['x-forwarded-for'] : undefined;
    const ip =
      (typeof forwarded === 'string' ? forwarded.split(',')[0]?.trim() : undefined) ??
      req.socket.remoteAddress ??
      'unknown';
    const origin = req.headers.origin;
    if (options.allowedOrigins && (!origin || !options.allowedOrigins.includes(origin))) {
      ws.close(CLOSE_FLOOD, 'origin not allowed');
      return;
    }
    if (connections.size >= maxConnections || (perIp.get(ip) ?? 0) >= maxPerIp) {
      ws.close(CLOSE_TRY_AGAIN_LATER, 'too many connections');
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
      // ~21 messages per second is normal (20 inputs + pings); allow bursts well above that.
      // One input every tick, plus pings, chat and emotes on top.
      messages: new TokenBucket(2 * TICK_RATE, TICK_RATE * 1.5),
      chat: new TokenBucket(4, 0.5),
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
      connections.delete(conn);
      const count = (perIp.get(ip) ?? 1) - 1;
      if (count <= 0) perIp.delete(ip);
      else perIp.set(ip, count);
      leave(conn);
    });
    // Errors (e.g. oversized frames) are followed by a close event, which does the cleanup.
    ws.on('error', () => {});
  });

  // Drop connections that stopped answering pings (closed laptop lids, dead networks).
  const heartbeat = setInterval(() => {
    for (const conn of connections) {
      if (!conn.alive) {
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
