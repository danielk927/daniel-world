import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { joinRoom } from '../net/connection.ts';
import { FakeSocket, latestSocket, welcome } from '../net/fakeSocket.ts';
import type { Hud } from '../ui/hud.ts';
import { LocalPlayer } from './localPlayer.ts';
import { Multiplayer, type MultiplayerDeps } from './multiplayer.ts';

/** Everything a Multiplayer touches, as stubs; the welcome has nobody else in it, so no DOM. */
function setup(room: string) {
  const stub = <T>(methods: Record<string, unknown>): T => methods as T;
  const onKill = vi.fn<MultiplayerDeps['onKill']>();
  const onSpawn = vi.fn<MultiplayerDeps['onSpawn']>();
  const onCoolerState = vi.fn<MultiplayerDeps['onCoolerState']>();
  const onCoolerHit = vi.fn<MultiplayerDeps['onCoolerHit']>();
  const addSystem = vi.fn<(text: string) => void>();
  const addMessage = vi.fn<(name: string, color: string, text: string) => void>();
  const setStatus = vi.fn<Hud['setStatus']>();
  const deps: MultiplayerDeps = {
    url: 'ws://test',
    name: 'Otter',
    room,
    prefs: { chef: true },
    player: new LocalPlayer(),
    avatars: stub({ add: vi.fn(), remove: vi.fn(), update: vi.fn(), playThrow: vi.fn() }),
    labels: stub({ add: vi.fn(), remove: vi.fn() }),
    hud: stub({ setRoom: vi.fn(), setPlayers: vi.fn(), setStatus }),
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
    onCoolerState,
    onCoolerHit,
  };
  return { deps, onKill, onSpawn, addSystem, addMessage, onCoolerState, onCoolerHit, setStatus };
}

const killOfSelf = { t: 'kill', knife: 1, from: 3, to: 7, at: 0.2 } as const;

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

  it("takes the walk-in's door from the welcome: untouched when it says nothing", () => {
    const { deps, onCoolerState } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(welcome('lobby'));
    expect(onCoolerState).toHaveBeenLastCalledWith([]);
    const dents = [{ z: -3, y: 1.6, by: 'fist' as const }];
    latestSocket().receive({ ...welcome('lobby'), cooler: { dents } });
    expect(onCoolerState).toHaveBeenLastCalledWith(dents);
    mp.close();
  });

  it("shows hits on the walk-in's door as what made them arrives on this screen", () => {
    const { deps, onCoolerHit } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(welcome('lobby'));
    const dent = { z: -3, y: 1.6, by: 'fist' as const };
    // Our own punch at once (the game waits for the fist itself); someone else's as their fist,
    // drawn in the past, reaches out; a knife's when its flight gets there.
    latestSocket().receive({ t: 'cooler', from: 7, dent });
    expect(onCoolerHit).toHaveBeenLastCalledWith({ t: 'cooler', from: 7, dent }, 0, true);
    latestSocket().receive({ t: 'cooler', from: 3, dent });
    const remote = onCoolerHit.mock.lastCall!;
    expect(remote[1]).toBeGreaterThan(0.1);
    expect(remote[2]).toBe(false);
    const knifeHit = { t: 'cooler', from: 3, dent, knife: { id: 4, at: 0.3 } } as const;
    latestSocket().receive(knifeHit);
    expect(onCoolerHit).toHaveBeenLastCalledWith(knifeHit, 0.5, false);
    mp.close();
  });

  it('plays solo, retrying, when the browser will not make a socket at all', async () => {
    FakeSocket.refuse = true;
    const { deps, setStatus } = setup('lobby');
    const mp = new Multiplayer(deps);
    expect(mp.status).toBe('connecting');
    await Promise.resolve();
    expect(mp.status).toBe('offline');
    expect(setStatus).toHaveBeenLastCalledWith('offline', { updating: false });
    // Every retry fails the same way, and still reports to this Multiplayer.
    vi.runOnlyPendingTimers();
    await Promise.resolve();
    expect(mp.status).toBe('offline');
    expect(deps.onStatus).toHaveBeenLastCalledWith('offline');
    mp.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('takes over a room joined in the background, replaying what arrived meanwhile', async () => {
    const joining = joinRoom(
      { url: 'ws://test', name: 'Otter', room: 'friday', intent: 'start', prefs: { chef: true } },
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
