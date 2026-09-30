import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  MAX_PLAYERS_PER_ROOM,
  PLAY_RADIUS,
  PROTOCOL_VERSION,
  TICK_MS,
  encode,
  normalizeRoomCode,
  parseClientMessage,
  sanitizeChat,
  sanitizeName,
  type ClientMessage,
  type ServerMessage,
} from '@world/shared';
import { StrikeCounter, TokenBucket } from './rateLimit.ts';
import { Room, type RoomPlayer } from './room.ts';

export interface ServerOptions {
  port: number;
  host?: string;
  tickMs?: number;
  heartbeatMs?: number;
  helloTimeoutMs?: number;
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

interface Connection {
  readonly ws: WebSocket;
  alive: boolean;
  room: Room | null;
  player: RoomPlayer | null;
  readonly messages: TokenBucket;
  readonly chat: TokenBucket;
  readonly emotes: TokenBucket;
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
  const r = Math.hypot(spawn.x, spawn.z);
  const scale = r > PLAY_RADIUS ? PLAY_RADIUS / r : 1;
  return { x: spawn.x * scale, z: spawn.z * scale, yaw: spawn.yaw };
}

export function startServer(options: ServerOptions): Promise<WorldServer> {
  const tickMs = options.tickMs ?? TICK_MS;
  const heartbeatMs = options.heartbeatMs ?? 10_000;
  const helloTimeoutMs = options.helloTimeoutMs ?? 10_000;
  const log = options.log ?? (() => {});
  const rooms = new Map<string, Room>();
  const connections = new Set<Connection>();
  let nextPlayerId = 1;

  const http: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
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
    if (url.pathname === '/health') {
      sendJson(res, 200, { ok: true });
      return;
    }
    const match = /^\/rooms\/([^/]{1,64})$/.exec(url.pathname);
    if (match) {
      const code = normalizeRoomCode(decodeURIComponent(match[1]!));
      sendJson(res, 200, {
        room: code,
        players: rooms.get(code)?.players.size ?? 0,
        max: MAX_PLAYERS_PER_ROOM,
      });
      return;
    }
    sendJson(res, 404, { error: 'not found' });
  });

  const wss = new WebSocketServer({ server: http, maxPayload: MAX_PAYLOAD_BYTES });

  const send = (conn: Connection, message: ServerMessage): void => {
    if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(encode(message));
  };

  const leave = (conn: Connection): void => {
    const { room, player } = conn;
    if (!room || !player) return;
    conn.room = null;
    conn.player = null;
    room.remove(player.id);
    log(`${player.name} (#${player.id}) left ${room.code} (${room.players.size} left)`);
    if (room.isEmpty) rooms.delete(room.code);
  };

  const handleHello = (conn: Connection, message: Extract<ClientMessage, { t: 'hello' }>): void => {
    if (conn.player) return;
    if (message.v !== PROTOCOL_VERSION) {
      send(conn, { t: 'error', code: 'version', message: 'Please reload the page to update.' });
      conn.ws.close(CLOSE_BAD_HELLO, 'version');
      return;
    }
    const code = normalizeRoomCode(message.room);
    let room = rooms.get(code);
    if (room?.isFull) {
      send(conn, { t: 'error', code: 'room_full', message: `Room "${code}" is full.` });
      conn.ws.close(CLOSE_ROOM_FULL, 'room full');
      return;
    }
    if (!room) {
      room = new Room(code);
      rooms.set(code, room);
    }
    const name = sanitizeName(message.name) || 'Guest';
    const player = room.add({
      id: nextPlayerId++,
      name,
      spawn: message.spawn ? clampSpawn(message.spawn) : undefined,
      send: (data) => {
        if (conn.ws.readyState === conn.ws.OPEN) conn.ws.send(data);
      },
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
    });
    log(`${name} (#${player.id}) joined ${code} (${room.players.size} players)`);
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
      case 'emote':
        if (conn.emotes.take())
          room.broadcast({ t: 'emote', id: player.id, emote: message.emote }, player.id);
        break;
    }
  };

  wss.on('connection', (ws: WebSocket) => {
    const conn: Connection = {
      ws,
      alive: true,
      room: null,
      player: null,
      // ~21 messages per second is normal (20 inputs + pings); allow bursts well above that.
      messages: new TokenBucket(60, 40),
      chat: new TokenBucket(4, 0.5),
      emotes: new TokenBucket(3, 1),
      strikes: new StrikeCounter(40, 10),
    };
    connections.add(conn);

    const helloTimer = setTimeout(() => {
      if (!conn.player) ws.close(CLOSE_HELLO_TIMEOUT, 'hello timeout');
    }, helloTimeoutMs);

    const strike = (): void => {
      if (conn.strikes.add()) {
        log(`disconnecting flooder${conn.player ? ` #${conn.player.id}` : ''}`);
        send(conn, { t: 'error', code: 'rate_limited', message: 'Too many messages.' });
        ws.close(CLOSE_FLOOD, 'rate limit');
      }
    };

    ws.on('pong', () => {
      conn.alive = true;
    });
    ws.on('message', (data: RawData, isBinary: boolean) => {
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
    for (const room of rooms.values()) room.step();
    nextTick += tickMs;
    tickTimer = setTimeout(runTick, Math.max(0, nextTick - performance.now()));
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
