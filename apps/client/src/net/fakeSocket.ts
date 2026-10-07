import { PROTOCOL_VERSION, type ServerMessage, type WelcomeMessage } from '@world/shared';

// Test doubles for the network, shared by the client's unit tests. Nothing in the app imports this.

/** Just enough of a browser WebSocket for Connection: the test plays the server. */
export class FakeSocket {
  static readonly OPEN = 1;
  static sockets: FakeSocket[] = [];
  static refuse = false;
  readyState = 0;
  closed = false;
  readonly sent: Record<string, unknown>[] = [];
  private readonly listeners = new Map<string, ((event: { data?: unknown }) => void)[]>();

  readonly url: string;

  constructor(url: string) {
    if (FakeSocket.refuse) throw new SyntaxError('cannot connect');
    this.url = url;
    FakeSocket.sockets.push(this);
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.readyState = 3;
    this.emit('close', {});
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.emit('open', {});
  }

  receive(message: ServerMessage): void {
    this.emit('message', { data: JSON.stringify(message) });
  }

  private emit(type: string, event: { data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

/** A welcome into `room` for player 7, alone there. */
export function welcome(room: string): WelcomeMessage {
  const self = {
    id: 7,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    grounded: true,
    ack: 0,
    dead: false,
    armed: true,
  };
  return {
    t: 'welcome',
    v: PROTOCOL_VERSION,
    id: 7,
    room,
    tick: 1,
    players: [{ id: 7, name: 'Otter', color: '#ffffff' }],
    self,
    knives: [],
  };
}

/** The socket the code under test opened last. */
export const latestSocket = (): FakeSocket => FakeSocket.sockets.at(-1)!;
