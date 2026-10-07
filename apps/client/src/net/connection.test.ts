import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, encode, type ServerMessage } from '@world/shared';
import { Connection } from './connection.ts';

/** Just enough of a browser WebSocket to watch what the connection sends. */
class FakeSocket {
  static readonly OPEN = 1;
  static readonly all: FakeSocket[] = [];
  readyState = 0;
  readonly sent: Record<string, unknown>[] = [];
  private readonly listeners = new Map<string, ((event: unknown) => void)[]>();

  constructor() {
    FakeSocket.all.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }

  close(): void {
    this.readyState = 3;
    this.emit('close', {});
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.emit('open', {});
  }

  receive(message: ServerMessage): void {
    this.emit('message', { data: encode(message) });
  }

  private emit(type: string, event: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const welcome: ServerMessage = {
  t: 'welcome',
  v: PROTOCOL_VERSION,
  id: 1,
  room: 'lobby',
  tick: 0,
  players: [],
  self: {
    id: 1,
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    yaw: 0,
    pitch: 0,
    grounded: true,
    dead: false,
    armed: true,
    ack: -1,
  },
  knives: [],
};

function connect(chef: boolean): Connection {
  return new Connection(
    'ws://test',
    'Otter',
    'lobby',
    () => undefined,
    { chef },
    {
      onStatus: () => {},
      onWelcome: () => {},
      onMessage: () => {},
      onFatal: () => {},
    },
  );
}

const socket = (): FakeSocket => FakeSocket.all.at(-1)!;
const prefsSent = (s: FakeSocket) => s.sent.filter((m) => m.t === 'prefs');

describe("Connection, with the visitor's prefs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('WebSocket', FakeSocket);
    FakeSocket.all.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('says them in the hello, and again only when they change', () => {
    const connection = connect(false);
    socket().open();
    expect(socket().sent[0]).toMatchObject({ t: 'hello', prefs: { chef: false } });
    socket().receive(welcome);
    expect(prefsSent(socket())).toEqual([]);
    connection.setPrefs({ chef: false });
    expect(prefsSent(socket())).toEqual([]);
    connection.setPrefs({ chef: true });
    expect(prefsSent(socket())).toEqual([{ t: 'prefs', prefs: { chef: true } }]);
    connection.close();
  });

  it('catches the server up on a change made while it waited for the welcome', () => {
    const connection = connect(true);
    socket().open();
    connection.setPrefs({ chef: false });
    // Not online yet: nothing goes out but the hello, which had the old choice.
    expect(socket().sent.map((m) => m.t)).toEqual(['hello']);
    socket().receive(welcome);
    expect(prefsSent(socket())).toEqual([{ t: 'prefs', prefs: { chef: false } }]);
    connection.close();
  });

  it('carries the current choice into the hello after a reconnect', () => {
    const connection = connect(true);
    socket().open();
    socket().receive(welcome);
    connection.setPrefs({ chef: false });
    socket().close();
    // Changed again while offline.
    connection.setPrefs({ chef: true });
    connection.setPrefs({ chef: false });
    // The first retry comes within 1.2 s.
    vi.advanceTimersByTime(1500);
    expect(FakeSocket.all).toHaveLength(2);
    socket().open();
    expect(socket().sent[0]).toMatchObject({ t: 'hello', prefs: { chef: false } });
    socket().receive(welcome);
    expect(prefsSent(socket())).toEqual([]);
    connection.close();
  });
});
