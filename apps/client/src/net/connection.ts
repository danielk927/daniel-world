import {
  PROTOCOL_VERSION,
  encode,
  parseServerMessage,
  type ClientMessage,
  type ServerMessage,
  type WelcomeMessage,
} from '@world/shared';

export type ConnectionStatus = 'connecting' | 'online' | 'offline';

export interface ConnectionHandlers {
  onStatus(status: ConnectionStatus, retryInMs: number | null): void;
  onWelcome(welcome: WelcomeMessage): void;
  onMessage(message: ServerMessage): void;
  /** The server refused us for good (room full, outdated client). No more retries. */
  onFatal(message: string): void;
}

const BACKOFF_START_MS = 1000;
const BACKOFF_MAX_MS = 15_000;
/** If the server accepts the socket but never welcomes us, give up and retry. */
const WELCOME_TIMEOUT_MS = 10_000;
const PING_INTERVAL_MS = 2000;

/**
 * One logical connection to a room. Handles the hello handshake, validates every incoming message,
 * measures round-trip time and reconnects with exponential backoff until closed.
 */
export class Connection {
  status: ConnectionStatus = 'connecting';
  /** Smoothed round-trip time in milliseconds, or null before the first pong. */
  rtt: number | null = null;

  private ws: WebSocket | null = null;
  private closed = false;
  private attempt = 0;
  private retryTimer = 0;
  private welcomeTimer = 0;
  private pingTimer = 0;
  private pingId = 0;
  private readonly pingSentAt = new Map<number, number>();
  private readonly url: string;
  private readonly name: string;
  private readonly room: string;
  private readonly spawnHint: () => { x: number; z: number; yaw: number } | undefined;
  private readonly handlers: ConnectionHandlers;

  constructor(
    url: string,
    name: string,
    room: string,
    spawnHint: () => { x: number; z: number; yaw: number } | undefined,
    handlers: ConnectionHandlers,
  ) {
    this.url = url;
    this.name = name;
    this.room = room;
    this.spawnHint = spawnHint;
    this.handlers = handlers;
    this.open();
  }

  get isOnline(): boolean {
    return this.status === 'online';
  }

  send(message: ClientMessage): void {
    if (this.status === 'online' && this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(encode(message));
    }
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
      const spawn = this.spawnHint();
      ws.send(
        encode({
          t: 'hello',
          v: PROTOCOL_VERSION,
          name: this.name,
          room: this.room,
          ...(spawn ? { spawn } : {}),
        }),
      );
    });
    ws.addEventListener('message', (event: MessageEvent<unknown>) => {
      const message = parseServerMessage(event.data);
      if (message) this.receive(message);
    });
    ws.addEventListener('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.clearTimers();
      this.rtt = null;
      this.scheduleRetry();
    });
    this.welcomeTimer = window.setTimeout(() => ws.close(), WELCOME_TIMEOUT_MS);
  }

  private receive(message: ServerMessage): void {
    switch (message.t) {
      case 'welcome':
        window.clearTimeout(this.welcomeTimer);
        this.attempt = 0;
        this.setStatus('online');
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
        if (message.code === 'room_full' || message.code === 'version') {
          this.closed = true;
          this.clearTimers();
          this.handlers.onFatal(message.message);
        }
        return;
      default:
        if (this.status === 'online') this.handlers.onMessage(message);
    }
  }

  private startPinging(): void {
    window.clearInterval(this.pingTimer);
    this.pingSentAt.clear();
    this.pingTimer = window.setInterval(() => {
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
    this.setStatus('offline', delay);
    this.retryTimer = window.setTimeout(() => this.open(), delay);
  }
}
