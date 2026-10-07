import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Connection, JoinError, joinRoom, type ConnectionHandlers } from './connection.ts';
import { FakeSocket, latestSocket as latest, welcome } from './fakeSocket.ts';

const options = { url: 'ws://test', name: 'Otter', room: 'friday', intent: 'start' as const };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('WebSocket', FakeSocket);
  FakeSocket.sockets = [];
  FakeSocket.refuse = false;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('joinRoom', () => {
  it('says hello with its intent and resolves on the welcome, keeping what came after', async () => {
    const joining = joinRoom(options, new AbortController().signal);
    latest().open();
    expect(latest().sent[0]).toMatchObject({ t: 'hello', room: 'friday', intent: 'start' });
    expect(latest().sent[0]).not.toHaveProperty('spawn');
    latest().receive(welcome('friday'));
    // Anything arriving before the new owner takes over is kept for it.
    latest().receive({ t: 'leave', id: 3 });
    const joined = await joining;
    expect(joined.welcome.room).toBe('friday');
    expect(joined.backlog).toEqual([{ t: 'leave', id: 3 }]);
    expect(joined.connection.isOnline).toBe(true);

    // Handed over, the connection reports to its new owner.
    const onMessage = vi.fn();
    joined.connection.setHandlers({
      onStatus: vi.fn(),
      onWelcome: vi.fn(),
      onMessage,
      onFatal: vi.fn(),
      spawnHint: () => ({ x: 1, z: 2, yaw: 0 }),
    });
    latest().receive({ t: 'leave', id: 4 });
    expect(onMessage).toHaveBeenCalledWith({ t: 'leave', id: 4 });
    joined.connection.close();
  });

  it.each(['room_full', 'room_taken', 'no_room'] as const)(
    'rejects with %s and closes the socket, without retrying',
    async (code) => {
      const joining = joinRoom(options, new AbortController().signal);
      latest().open();
      latest().receive({ t: 'error', code, message: 'no' });
      await expect(joining).rejects.toEqual(new JoinError(code));
      expect(latest().closed).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it('rejects as unreachable when the socket closes first, leaving no timers behind', async () => {
    const joining = joinRoom(options, new AbortController().signal);
    latest().close();
    await expect(joining).rejects.toMatchObject({ failure: 'unreachable' });
    expect(vi.getTimerCount()).toBe(0);
    expect(FakeSocket.sockets).toHaveLength(1);
  });

  it('rejects as unreachable when a socket cannot even be made', async () => {
    FakeSocket.refuse = true;
    const joining = joinRoom(options, new AbortController().signal);
    await expect(joining).rejects.toMatchObject({ failure: 'unreachable' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('tells a version mismatch apart', async () => {
    const joining = joinRoom(options, new AbortController().signal);
    latest().open();
    latest().receive({ t: 'error', code: 'version', message: 'reload' });
    latest().close();
    await expect(joining).rejects.toMatchObject({ failure: 'version' });
  });

  it('can be called off, before or after it is let in', async () => {
    const before = new AbortController();
    const joining = joinRoom(options, before.signal);
    before.abort();
    await expect(joining).rejects.toMatchObject({ failure: 'cancelled' });
    expect(latest().closed).toBe(true);

    const already = new AbortController();
    already.abort();
    await expect(joinRoom(options, already.signal)).rejects.toMatchObject({
      failure: 'cancelled',
    });
    expect(latest().closed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('Connection', () => {
  it('only states its intent until it is let in, so a reconnect just rejoins', () => {
    const handlers: ConnectionHandlers = {
      onStatus: vi.fn(),
      onWelcome: vi.fn(),
      onMessage: vi.fn(),
      onFatal: vi.fn(),
      spawnHint: () => ({ x: 1, z: 2, yaw: 0.5 }),
    };
    const connection = new Connection({ ...options, intent: 'join', handlers });
    latest().open();
    expect(latest().sent[0]).toMatchObject({ intent: 'join' });
    latest().receive(welcome('friday'));
    expect(connection.retrying).toBe(false);

    // The connection drops; the retry says hello again, without the intent.
    latest().close();
    expect(connection.status).toBe('offline');
    expect(connection.retrying).toBe(true);
    vi.runOnlyPendingTimers();
    latest().open();
    expect(latest().sent[0]).toMatchObject({ t: 'hello', spawn: { x: 1, z: 2, yaw: 0.5 } });
    expect(latest().sent[0]).not.toHaveProperty('intent');
    connection.close();
    expect(vi.getTimerCount()).toBe(0);
  });
});
