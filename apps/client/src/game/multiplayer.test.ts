import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { joinRoom } from '../net/connection.ts';
import { FakeSocket, latestSocket, welcome } from '../net/fakeSocket.ts';
import { LocalPlayer } from './localPlayer.ts';
import { Multiplayer, type MultiplayerDeps } from './multiplayer.ts';

/** Everything a Multiplayer touches, as stubs; the welcome has nobody else in it, so no DOM. */
function setup(room: string) {
  const stub = <T>(methods: Record<string, unknown>): T => methods as T;
  const onKill = vi.fn<MultiplayerDeps['onKill']>();
  const onSpawn = vi.fn<MultiplayerDeps['onSpawn']>();
  const addSystem = vi.fn<(text: string) => void>();
  const addMessage = vi.fn<(name: string, color: string, text: string) => void>();
  const deps: MultiplayerDeps = {
    url: 'ws://test',
    name: 'Otter',
    room,
    player: new LocalPlayer(),
    avatars: stub({ add: vi.fn(), remove: vi.fn(), update: vi.fn(), playThrow: vi.fn() }),
    labels: stub({ add: vi.fn(), remove: vi.fn() }),
    hud: stub({ setRoom: vi.fn(), setPlayers: vi.fn(), setStatus: vi.fn() }),
    chat: stub({ addSystem, addMessage }),
    knives: stub({
      reset: vi.fn(),
      goOffline: vi.fn(),
      resolve: vi.fn(),
      // The knife reaches the player half a second after the server's word.
      timeUntil: () => 0.5,
    }),
    worldTime: () => 0,
    notify: vi.fn(),
    onFatal: vi.fn(),
    onStatus: vi.fn(),
    onSpawn,
    onKill,
    onBackOnFeet: vi.fn(),
  };
  return { deps, onKill, onSpawn, addSystem, addMessage };
}

const killOfSelf = { t: 'kill', knife: 1, from: 3, to: 7, at: 0.2 } as const;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('WebSocket', FakeSocket);
  FakeSocket.sockets = [];
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Multiplayer', () => {
  it('announces a kill once its knife arrives on this screen', () => {
    const { deps, onKill } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(welcome('lobby'));
    latestSocket().receive(killOfSelf);
    expect(onKill).not.toHaveBeenCalled();
    vi.advanceTimersByTime(600);
    expect(onKill).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'victim');
    mp.close();
  });

  it('forgets a kill still in flight when the room is left, so it cannot follow the player', () => {
    const { deps, onKill } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(welcome('lobby'));
    latestSocket().receive(killOfSelf);
    mp.close();
    vi.advanceTimersByTime(1000);
    expect(onKill).not.toHaveBeenCalled();
    expect(mp.selfId).toBeNull();
  });

  it('takes over a room joined in the background, replaying what arrived meanwhile', async () => {
    const joining = joinRoom(
      { url: 'ws://test', name: 'Otter', room: 'friday', intent: 'start' },
      new AbortController().signal,
    );
    latestSocket().open();
    latestSocket().receive(welcome('friday'));
    latestSocket().receive({ t: 'chat', id: 7, name: 'Otter', text: 'early' });
    const { deps, onSpawn, addSystem, addMessage } = setup('friday');
    const mp = new Multiplayer(deps, await joining);
    expect(mp.isOnline).toBe(true);
    expect(mp.selfId).toBe(7);
    expect(onSpawn).toHaveBeenCalledOnce();
    expect(addSystem).toHaveBeenCalledWith('You joined #friday. Nobody else is here yet.');
    expect(addMessage).toHaveBeenCalledWith('Otter', '#ffffff', 'early');
    // From here on the connection reports to this Multiplayer.
    latestSocket().receive({ t: 'chat', id: 7, name: 'Otter', text: 'later' });
    expect(addMessage).toHaveBeenLastCalledWith('Otter', '#ffffff', 'later');
    mp.close();
    expect(latestSocket().closed).toBe(true);
  });
});
