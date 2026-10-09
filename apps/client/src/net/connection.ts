import {
  PROTOCOL_VERSION,
  encode,
  parseServerMessage,
  samePrefs,
  type ClientMessage,
  type ErrorCode,
  type Prefs,
  type RoomIntent,
  type ServerMessage,
  type WelcomeMessage,
} from '@world/shared';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export interface ConnectionHandlers {
  onStatus(status: ConnectionStatus, retryInMs: number | null): void;
  onWelcome(welcome: WelcomeMessage): void;
  onMessage(message: ServerMessage): void;
  /** The server refused us for good (the room is full, taken, or empty). No more retries. */
  onFatal(code: ErrorCode, message: string): void;
  /** Where to ask to stand on (re)joining, or undefined for a spawn point. */
  spawnHint(): { x: number; z: number; yaw: number } | undefined;
}

export interface ConnectionOptions {
  url: string;
  name: string;
  room: string;
  /** Start or join a party; only the first hello says so, so reconnects just rejoin. */
  intent?: RoomIntent;
  /** Sent with every hello; change them later with setPrefs. */
  prefs: Readonly<Prefs>;
  handlers: ConnectionHandlers;
}

/** Refusals that retrying cannot fix. */
const FATAL_ERRORS: ReadonlySet<ErrorCode> = new Set(['room_full', 'room_taken', 'no_room']);

const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 15_000;
/** If the server accepts the socket but never welcomes us, give up and retry. */
const WELCOME_TIMEOUT_MS = 10_000;
const PING_INTERVAL_MS = 1000;
/** Snapshots arrive 20 times a second; this much silence means the connection is dead. */
const SILENCE_TIMEOUT_MS = 4000;

/**
 * One logical connection to a room. Handles the hello handshake, validates every incoming message,
 * measures round-trip time and reconnects with exponential backoff until closed. The visitor's
 * prefs go with every hello and to the server whenever they change.
 */
export class Connection {
  status: ConnectionStatus = 'connecting';
  /** Smoothed round-trip time in milliseconds, or null before the first pong. */
  rtt: number | null = null;
  /**
   * The server speaks another protocol version: this page and the room server come from different
   * deploys. Not fatal: the world stays playable solo, and retrying joins once both sides match.
   */
  versionMismatch = false;

  private ws: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private retryTimer = 0;
  private welcomeTimer = 0;
  private pingTimer = 0;
  private pingId = 0;
  private lastMessageAt = 0;
  private readonly pingSentAt = new Map<number, number>();
  private prefs: Readonly<Prefs>;
  /** The prefs the server has, or will have once it reads our hello. */
  private sentPrefs: Readonly<Prefs> | null = null;
  private readonly url: string;
  private readonly name: string;
  private readonly room: string;
  private intent: RoomIntent | undefined;
  private handlers: ConnectionHandlers;

  constructor(options: ConnectionOptions) {
    this.url = options.url;
    this.name = options.name;
    this.room = options.room;
    this.intent = options.intent;
    this.prefs = options.prefs;
    this.handlers = options.handlers;
    this.open();
  }

  /** Hand the connection to a new owner, as when a room joined in the background takes over. */
  setHandlers(handlers: ConnectionHandlers): void {
    this.handlers = handlers;
  }

  get isOnline(): boolean {
    return this.status === 'online';
  }

  /** Trying again after failing to connect or losing the connection, not yet back. */
  get retrying(): boolean {
    return this.attempt > 0;
  }

  send(message: ClientMessage): void {
    if (this.status === 'online' && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(encode(message));
    }
  }

  /** Takes effect at once when online; otherwise the next hello carries it. */
  setPrefs(prefs: Readonly<Prefs>): void {
    this.prefs = prefs;
    this.syncPrefs();
  }

  private syncPrefs(): void {
    if (!this.isOnline || (this.sentPrefs && samePrefs(this.sentPrefs, this.prefs))) return;
    this.send({ t: 'prefs', prefs: this.prefs });
    this.sentPrefs = this.prefs;
  }

  close(): void {
    this.closed = true;
    this.clearTimers();
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000, 'bye');
  }

  private setStatus(status: ConnectionStatus, retryInMs: number | null = null): void {
    this.status = status;
    this.handlers.onStatus(status, retryInMs);
  }

  private clearTimers(): void {
    window.clearTimeout(this.retryTimer);
    window.clearTimeout(this.welcomeTimer);
    window.clearInterval(this.pingTimer);
  }

  private open(): void {
    if (this.closed) return;
    this.setStatus('connecting');
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url);
    } catch {
      this.scheduleRetry();
      return;
    }
    this.ws = ws;
    ws.addEventListener('open', () => {
      if (this.ws !== ws) return;
      const spawn = this.handlers.spawnHint();
      this.sentPrefs = this.prefs;
      ws.send(
        encode({
          t: 'hello',
          v: PROTOCOL_VERSION,
          name: this.name,
          room: this.room,
          ...(spawn ? { spawn } : {}),
          prefs: this.prefs,
          ...(this.intent ? { intent: this.intent } : {}),
        }),
      );
    });
    ws.addEventListener('message', (event: MessageEvent<unknown>) => {
      if (this.ws !== ws) return;
      this.lastMessageAt = performance.now();
      const message = parseServerMessage(event.data);
      if (message) this.receive(message);
    });
    ws.addEventListener('close', () => this.lose(ws));
    this.welcomeTimer = window.setTimeout(() => this.lose(ws), WELCOME_TIMEOUT_MS);
  }

  /**
   * Done with this socket, whether it closed or went quiet: offline at once, and the next attempt
   * on its way. It is told to close, but not waited on: on a network that has stopped answering,
   * the browser holds a closing socket open for up to a minute. Nothing it says after this is heard.
   */
  private lose(ws: WebSocket): void {
    if (this.ws !== ws) return;
    this.ws = null;
    this.clearTimers();
    this.rtt = null;
    ws.close();
    this.scheduleRetry();
  }

  private receive(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome':
        window.clearTimeout(this.welcomeTimer);
        this.attempt = 0;
        this.intent = undefined;
        this.versionMismatch = false;
        this.setStatus('online');
        // Changed while we waited for the welcome: the hello had the old ones.
        this.syncPrefs();
        this.startPinging();
        this.handlers.onWelcome(message);
        return;
      case 'pong': {
        const sentAt = this.pingSentAt.get(message.id);
        this.pingSentAt.delete(message.id);
        if (sentAt !== undefined) {
          const sample = performance.now() - sentAt;
          this.rtt = this.rtt === null ? sample : this.rtt * 0.8 + sample * 0.2;
        }
        return;
      }
      case 'error':
        // The server closes the socket after this, which schedules the next attempt.
        if (message.code === 'version') this.versionMismatch = true;
        if (FATAL_ERRORS.has(message.code)) {
          this.closed = true;
          this.clearTimers();
          this.handlers.onFatal(message.code, message.message);
        }
        return;
      default:
        if (this.status === 'online') this.handlers.onMessage(message);
    }
  }

  private startPinging(): void {
    window.clearInterval(this.pingTimer);
    this.pingSentAt.clear();
    this.lastMessageAt = performance.now();
    this.pingTimer = window.setInterval(() => {
      // A socket can stay "open" long after the network is gone (sleep, NAT timeout).
      if (performance.now() - this.lastMessageAt > SILENCE_TIMEOUT_MS) {
        if (this.ws) this.lose(this.ws);
        return;
      }
      const id = this.pingId++;
      this.pingSentAt.set(id, performance.now());
      // Forget pings that were never answered so the map cannot grow.
      if (this.pingSentAt.size > 10) this.pingSentAt.delete(this.pingSentAt.keys().next().value!);
      this.send({ t: 'ping', id });
    }, PING_INTERVAL_MS);
  }

  private scheduleRetry(): void {
    if (this.closed) return;
    const base = Math.min(BACKOFF_MAX_MS, BACKOFF_START_MS * 2 ** this.attempt);
    // Jitter so a server restart is not hit by every client at the same instant.
    const delay = Math.round(base * (0.8 + Math.random() * 0.4));
    this.attempt++;
    // Armed before saying so: whoever hears "offline" may close the connection, clearing it.
    this.retryTimer = window.setTimeout(() => this.open(), delay);
    this.setStatus('offline', delay);
  }
}

export interface JoinedRoom {
  readonly connection: Connection;
  readonly welcome: WelcomeMessage;
  /** Messages that arrived after the welcome, before the new owner took the connection. */
  readonly backlog: readonly ServerMessage[];
}

/** Why `joinRoom` did not get in. */
export class JoinError extends Error {
  readonly failure: ErrorCode | 'unreachable' | 'cancelled';

  constructor(failure: ErrorCode | 'unreachable' | 'cancelled') {
    super(`could not join: ${failure}`);
    this.failure = failure;
  }
}

/**
 * Join a room in the background, once, without retrying: resolves when welcomed, or rejects with a
 * `JoinError` saying why not (full, taken, nobody there, unreachable). Moving between rooms joins
 * the next one before leaving the last, so a move that fails leaves the player where they were.
 */
export function joinRoom(
  options: Omit<ConnectionOptions, 'handlers'>,
  signal: AbortSignal,
): Promise<JoinedRoom> {
  return new Promise((resolve, reject) => {
    let connection: Connection | null = null;
    let settled = false;
    const backlog: ServerMessage[] = [];
    const fail = (failure: JoinError['failure']): void => {
      if (settled) return;
      settled = true;
      connection?.close();
      reject(new JoinError(failure));
    };
    connection = new Connection({
      ...options,
      handlers: {
        onStatus: (status) => {
          if (status === 'offline') fail(connection?.versionMismatch ? 'version' : 'unreachable');
        },
        onWelcome: (welcome) => {
          if (settled) return;
          settled = true;
          resolve({ connection: connection!, welcome, backlog });
        },
        onMessage: (message) => backlog.push(message),
        onFatal: (code) => fail(code),
        // A new room starts at one of its own spawn points.
        spawnHint: () => undefined,
      },
    });
    // A failure inside the constructor came before `connection` was set, so close it now.
    if (settled) connection.close();
    signal.addEventListener('abort', () => fail('cancelled'), { once: true });
    if (signal.aborted) fail('cancelled');
  });
}
