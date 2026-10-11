import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HitMessage, KillMessage, WelcomeMessage } from '@world/shared';
import { joinRoom } from '../net/connection.ts';
import { FakeSocket, latestSocket, welcome } from '../net/fakeSocket.ts';
import type { Hud } from '../ui/hud.ts';
import type { ScoreRow, Scoreboard } from '../ui/scoreboard.ts';
import { LocalPlayer } from './localPlayer.ts';
import { Multiplayer, type MultiplayerDeps } from './multiplayer.ts';

/**
 * Everything a Multiplayer touches, as stubs. A welcome with nobody else in it needs no DOM; one
 * with other cooks builds their name tags, for which the tests give the page `FakeElement`s.
 */
function setup(room: string) {
  const stub = <T>(methods: Record<string, unknown>): T => methods as T;
  const onKill = vi.fn<MultiplayerDeps['onKill']>();
  const onHit = vi.fn<MultiplayerDeps['onHit']>();
  const onSpawn = vi.fn<MultiplayerDeps['onSpawn']>();
  const onBackOnFeet = vi.fn<MultiplayerDeps['onBackOnFeet']>();
  const onCoolerState = vi.fn<MultiplayerDeps['onCoolerState']>();
  const onCoolerHit = vi.fn<MultiplayerDeps['onCoolerHit']>();
  const addSystem = vi.fn<(text: string) => void>();
  const addMessage = vi.fn<(name: string, color: string, text: string) => void>();
  const setStatus = vi.fn<Hud['setStatus']>();
  const playHit = vi.fn<(id: number, time: number) => void>();
  const setRows = vi.fn<Scoreboard['setRows']>();
  const resolve = vi.fn();
  /** How long each knife takes to arrive on this screen after the server's word: half a second. */
  const waits = new Map<number, number>();
  const deps: MultiplayerDeps = {
    url: 'ws://test',
    name: 'Otter',
    room,
    prefs: { chef: true },
    player: new LocalPlayer(),
    avatars: stub({
      add: vi.fn(),
      remove: vi.fn(),
      update: vi.fn(),
      playThrow: vi.fn(),
      playHit,
      setLook: vi.fn(),
    }),
    labels: stub({ add: vi.fn(), remove: vi.fn() }),
    hud: stub({ setRoom: vi.fn(), setPlayers: vi.fn(), setStatus }),
    scoreboard: stub({ setRows }),
    chat: stub({ addSystem, addMessage }),
    knives: stub({
      reset: vi.fn(),
      goOffline: vi.fn(),
      resolve,
      // The knife reaches the player half a second after the server's word, unless `waits` says so.
      timeUntil: (id: number) => waits.get(id) ?? 0.5,
    }),
    worldTime: () => 0,
    notify: vi.fn(),
    onFatal: vi.fn(),
    onStatus: vi.fn(),
    onSpawn,
    onKill,
    onHit,
    onBackOnFeet,
    onCoolerState,
    onCoolerHit,
  };
  /** The scoreboard's latest rows, by id. */
  const rows = (): ScoreRow[] => [...setRows.mock.lastCall![0]].sort((a, b) => a.id - b.id);
  return {
    deps,
    onKill,
    onHit,
    onSpawn,
    onBackOnFeet,
    addSystem,
    addMessage,
    onCoolerState,
    onCoolerHit,
    setStatus,
    playHit,
    resolve,
    waits,
    rows,
  };
}

/** Just enough of a page to build a name tag: elements that take whatever `el` gives them. */
class FakeElement {
  className = '';
  textContent = '';
  hidden = false;
  style = { setProperty: vi.fn() };
  setAttribute(): void {}
  append(): void {}
}

/** Player 7's welcome, with the cooks `others` in the room too, and everyone's `scores`. */
function withOthers(
  room: string,
  others: readonly { id: number; name: string; resident?: true }[],
  scores: WelcomeMessage['scores'] = [],
): WelcomeMessage {
  const base = welcome(room);
  return {
    ...base,
    players: [
      ...base.players,
      ...others.map(({ id, name, resident }) => ({
        id,
        name,
        color: '#4fb3ff',
        prefs: { chef: true },
        ...(resident ? { resident } : {}),
      })),
    ],
    scores,
  };
}

const killOfSelf: KillMessage = { t: 'kill', knife: 1, from: 3, to: 7, at: 0.2, scores: [] };
const hitOnSelf: HitMessage = { t: 'hit', knife: 1, from: 3, to: 7, health: 2, at: 0.2 };

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('document', { createElement: () => new FakeElement() });
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

  it("says which moment it saw the room at only once this connection's snapshots set the clock", () => {
    const { deps } = setup('lobby');
    const mp = new Multiplayer(deps);
    const inputs = () => latestSocket().sent.filter((m) => m.t === 'input');
    const send = (): void => mp.sendInput(deps.player.tick(0, 0, 0, true));
    latestSocket().open();
    latestSocket().receive(welcome('lobby'));
    send();
    expect(inputs().at(-1)).not.toHaveProperty('view');
    latestSocket().receive({ t: 'snap', tick: 500, players: [welcome('lobby').self] });
    mp.update(performance.now(), 1 / 60);
    send();
    expect(inputs().at(-1)).toHaveProperty('view');

    // A reconnect: the old session's moment is meaningless to the new one.
    latestSocket().close();
    vi.runOnlyPendingTimers();
    latestSocket().open();
    latestSocket().receive(welcome('lobby'));
    send();
    expect(inputs().at(-1)).not.toHaveProperty('view');
    mp.close();

    // Nor does it follow the cook into the next room.
    const next = new Multiplayer({ ...deps, room: 'friday' });
    latestSocket().open();
    latestSocket().receive(welcome('friday'));
    next.sendInput(deps.player.tick(0, 0, 0, true));
    expect(inputs().at(-1)).not.toHaveProperty('view');
    next.close();
  });

  it('keeps a cook turned away by a full room on a reconnect, solo, saying why once', () => {
    const { deps, addSystem } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(welcome('lobby'));
    latestSocket().close();
    const full = 'The lobby is full right now, so you are cooking solo.';
    for (let i = 0; i < 2; i++) {
      vi.runOnlyPendingTimers();
      latestSocket().open();
      latestSocket().receive({ t: 'error', code: 'room_full', message: 'full' });
      latestSocket().close();
    }
    expect(deps.onFatal).not.toHaveBeenCalled();
    expect(mp.status).toBe('offline');
    // The server answered, so other rooms are worth trying.
    expect(mp.reachable).toBe(true);
    expect(addSystem.mock.calls.filter(([line]) => line.startsWith(full))).toHaveLength(1);
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

describe('hits', () => {
  it('announces a hit once its knife arrives on this screen, with the health it left', () => {
    const { deps, onHit, resolve } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(welcome('lobby'));
    latestSocket().receive(hitOnSelf);
    // The knife is gone as it arrives, as it is for a knockout.
    expect(resolve).toHaveBeenCalledWith(1, { kind: 'hit', at: 0.2 });
    expect(onHit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(onHit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(200);
    expect(onHit).toHaveBeenCalledOnce();
    expect(onHit).toHaveBeenCalledWith(expect.anything(), expect.anything(), 2, 'victim');
    mp.close();
  });

  it('tells a thrower of their hit, and a bystander of the cook it hit, who rocks back', () => {
    const { deps, onHit, playHit } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(
      withOthers('lobby', [
        { id: 3, name: 'Cook' },
        { id: 4, name: 'Other' },
      ]),
    );
    // This player's knife hit cook 3; cook 3's hit cook 4.
    latestSocket().receive({ ...hitOnSelf, from: 7, to: 3, health: 1 });
    latestSocket().receive({ ...hitOnSelf, knife: 2, from: 3, to: 4, health: 2 });
    vi.advanceTimersByTime(600);
    expect(
      onHit.mock.calls.map(([thrower, victim, health, role]) => [
        thrower.name,
        victim.name,
        health,
        role,
      ]),
    ).toEqual([
      ['Otter', 'Cook', 1, 'thrower'],
      ['Cook', 'Other', 2, 'witness'],
    ]);
    // Each cook who was hit rocks back as the knife reaches them, as drawn.
    expect(playHit.mock.calls.map(([id]) => id)).toEqual([3, 4]);
    mp.close();
  });

  it('does not rock this player back: their own screen is the view, and flinches instead', () => {
    const { deps, playHit } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(welcome('lobby'));
    latestSocket().receive(hitOnSelf);
    vi.advanceTimersByTime(600);
    expect(playHit).not.toHaveBeenCalled();
    mp.close();
  });

  it('does not take a hit that arrives after the cook has been back up with all their health', () => {
    const { deps, onHit } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(welcome('lobby'));
    latestSocket().receive(hitOnSelf);
    // Respawned in the meantime (a screen too busy to run its timers can be that late).
    latestSocket().receive({ t: 'respawn', player: welcome('lobby').self });
    vi.advanceTimersByTime(1000);
    expect(onHit).not.toHaveBeenCalled();
    mp.close();
  });

  it('shows only the hit that leaves the least health when two arrive out of order', () => {
    const { deps, onHit, waits } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(welcome('lobby'));
    // The room hit this player twice, one tick apart: to two health, then to one. A screen can
    // show them the other way round (the second knife's flight is drawn quicker than the first's),
    // and must not then show the bar back at two.
    waits.set(1, 0.6);
    waits.set(2, 0.2);
    latestSocket().receive({ ...hitOnSelf, knife: 1, health: 2 });
    latestSocket().receive({ ...hitOnSelf, knife: 2, health: 1 });
    vi.advanceTimersByTime(1000);
    expect(onHit.mock.calls.map((call) => call[2])).toEqual([1]);
    mp.close();
  });

  it('shows both hits, in turn, when they arrive in the order they came', () => {
    const { deps, onHit } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(welcome('lobby'));
    latestSocket().receive({ ...hitOnSelf, knife: 1, health: 2 });
    latestSocket().receive({ ...hitOnSelf, knife: 2, health: 1 });
    vi.advanceTimersByTime(1000);
    expect(onHit.mock.calls.map((call) => call[2])).toEqual([2, 1]);
    mp.close();
  });

  it('shows no hit once the knockout has been shown, however late its knife arrives', () => {
    const { deps, onHit, onKill, waits } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(welcome('lobby'));
    // A hit to one health whose knife is a long flight on this screen, and the knockout one tick
    // after it, whose knife is a short one: the knockout is shown first.
    waits.set(1, 0.9);
    waits.set(2, 0.2);
    latestSocket().receive({ ...hitOnSelf, knife: 1, health: 1 });
    latestSocket().receive({ ...killOfSelf, knife: 2 });
    vi.advanceTimersByTime(1500);
    expect(onKill).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'victim');
    expect(onHit).not.toHaveBeenCalled();
    mp.close();
  });

  it("shows a hit on another cook as it comes, knockout or not: only this player's bar is kept", () => {
    const { deps, onHit, onKill, waits } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(withOthers('lobby', [{ id: 3, name: 'Cook' }]));
    waits.set(1, 0.9);
    waits.set(2, 0.2);
    latestSocket().receive({ ...hitOnSelf, knife: 1, from: 7, to: 3, health: 1 });
    latestSocket().receive({ ...killOfSelf, knife: 2, from: 7, to: 3 });
    vi.advanceTimersByTime(1500);
    expect(onKill).toHaveBeenCalledTimes(1);
    expect(onHit).toHaveBeenCalledTimes(1);
    mp.close();
  });

  it('puts a knockout whose cook has since respawned in the feed, without knocking them out', () => {
    const { deps, onKill } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(welcome('lobby'));
    latestSocket().receive(killOfSelf);
    // Back up in the meantime (a screen too busy to run its timers can be that late): there is no
    // knockout card to wait out, where no respawn will ever come.
    latestSocket().receive({ t: 'respawn', player: welcome('lobby').self });
    vi.advanceTimersByTime(1000);
    expect(onKill).toHaveBeenCalledOnce();
    expect(onKill).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'witness');
    mp.close();
  });

  it('still counts the score of a knockout whose cook has since respawned', () => {
    const { deps, rows } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(withOthers('lobby', [{ id: 3, name: 'Cook' }]));
    latestSocket().receive({
      ...killOfSelf,
      scores: [
        { id: 3, kills: 1, deaths: 0, assists: 0 },
        { id: 7, kills: 0, deaths: 1, assists: 0 },
      ],
    });
    latestSocket().receive({ t: 'respawn', player: welcome('lobby').self });
    vi.advanceTimersByTime(1000);
    expect(rows().map((r) => [r.id, r.kills, r.deaths])).toEqual([
      [3, 1, 0],
      [7, 0, 1],
    ]);
    mp.close();
  });

  it('forgets a hit still in flight when the room is left, as it does a kill', () => {
    const { deps, onHit } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(welcome('lobby'));
    latestSocket().receive(hitOnSelf);
    mp.close();
    vi.advanceTimersByTime(1000);
    expect(onHit).not.toHaveBeenCalled();
  });

  it('stands this player back up, with all their health, on every welcome', () => {
    const { deps, onBackOnFeet } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(welcome('lobby'));
    expect(onBackOnFeet).toHaveBeenCalledTimes(1);
    // Losing the connection puts them on their feet too (they play on solo, whole).
    latestSocket().close();
    const offline = onBackOnFeet.mock.calls.length;
    expect(offline).toBeGreaterThan(1);
    // And the reconnect's own welcome does, exactly once more.
    vi.runOnlyPendingTimers();
    latestSocket().open();
    latestSocket().receive(welcome('lobby'));
    expect(onBackOnFeet).toHaveBeenCalledTimes(offline + 1);
    mp.close();
  });
});

describe('scores', () => {
  it('lists this player alone, with nothing yet, before there is a welcome', () => {
    const { deps, rows } = setup('lobby');
    const mp = new Multiplayer(deps);
    expect(rows()).toEqual([
      { id: -1, name: 'Otter', color: '#fff8f0', kills: 0, deaths: 0, assists: 0, isSelf: true },
    ]);
    mp.close();
  });

  it("takes everyone's score from the welcome, this player marked", () => {
    const { deps, rows } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(
      withOthers(
        'lobby',
        [{ id: 3, name: 'Chef Skinner', resident: true }],
        [
          { id: 7, kills: 1, deaths: 2, assists: 3 },
          { id: 3, kills: 4, deaths: 5, assists: 6 },
        ],
      ),
    );
    expect(rows()).toEqual([
      {
        id: 3,
        name: 'Chef Skinner',
        color: '#4fb3ff',
        kills: 4,
        deaths: 5,
        assists: 6,
        isSelf: false,
      },
      { id: 7, name: 'Otter', color: '#ffffff', kills: 1, deaths: 2, assists: 3, isSelf: true },
    ]);
    mp.close();
  });

  it('starts a cook who joins at nothing, and drops one who leaves', () => {
    const { deps, rows } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(welcome('lobby'));
    latestSocket().receive({
      t: 'join',
      player: { id: 3, name: 'Newcomer', color: '#4fb3ff', prefs: { chef: true } },
    });
    expect(rows().map((r) => [r.id, r.kills, r.deaths, r.assists])).toEqual([
      [3, 0, 0, 0],
      [7, 0, 0, 0],
    ]);
    latestSocket().receive({ t: 'leave', id: 3 });
    expect(rows().map((r) => r.id)).toEqual([7]);
    mp.close();
  });

  it("takes a knockout's scores as its knife arrives on this screen, not before", () => {
    const { deps, rows } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(withOthers('lobby', [{ id: 3, name: 'Cook' }]));
    latestSocket().receive({
      ...killOfSelf,
      scores: [
        { id: 3, kills: 1, deaths: 0, assists: 0 },
        { id: 7, kills: 0, deaths: 1, assists: 0 },
      ],
    });
    // The knife is half a second off: the scoreboard does not give it away.
    expect(rows().map((r) => r.kills + r.deaths)).toEqual([0, 0]);
    vi.advanceTimersByTime(600);
    expect(rows().map((r) => [r.id, r.kills, r.deaths, r.assists])).toEqual([
      [3, 1, 0, 0],
      [7, 0, 1, 0],
    ]);
    mp.close();
  });

  it('leaves the rows of cooks a knockout did not change alone, and ignores one who has left', () => {
    const { deps, rows } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(
      withOthers(
        'lobby',
        [{ id: 3, name: 'Cook' }],
        [
          { id: 7, kills: 2, deaths: 0, assists: 0 },
          { id: 3, kills: 0, deaths: 2, assists: 0 },
        ],
      ),
    );
    latestSocket().receive({
      ...killOfSelf,
      from: 7,
      to: 3,
      // Cook 9 left while the knife flew.
      scores: [
        { id: 7, kills: 3, deaths: 0, assists: 0 },
        { id: 9, kills: 0, deaths: 0, assists: 1 },
      ],
    });
    vi.advanceTimersByTime(600);
    expect(rows().map((r) => [r.id, r.kills, r.deaths, r.assists])).toEqual([
      [3, 0, 2, 0],
      [7, 3, 0, 0],
    ]);
    mp.close();
  });

  it('never takes a count back when two knockouts show in the opposite order to the room', () => {
    const { deps, rows } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(withOthers('lobby', [{ id: 3, name: 'Cook' }]));
    // The room knocked cook 3 out twice, this player's knife both times. A screen can show the
    // second knockout before the first (a knife of this player's own is drawn at once, another's
    // a little after the server threw it), so the second's tallies come first here.
    const second: KillMessage = {
      ...killOfSelf,
      knife: 2,
      scores: [
        { id: 7, kills: 2, deaths: 0, assists: 1 },
        { id: 3, kills: 0, deaths: 2, assists: 0 },
      ],
    };
    const first: KillMessage = {
      ...killOfSelf,
      knife: 1,
      scores: [
        { id: 7, kills: 1, deaths: 0, assists: 1 },
        { id: 3, kills: 0, deaths: 1, assists: 0 },
      ],
    };
    latestSocket().receive(second);
    vi.advanceTimersByTime(600);
    latestSocket().receive(first);
    vi.advanceTimersByTime(600);
    // The older tallies, shown last, take nothing away.
    expect(rows().map((r) => [r.id, r.kills, r.deaths, r.assists])).toEqual([
      [3, 0, 2, 0],
      [7, 2, 0, 1],
    ]);
    mp.close();
  });

  it('shows just this player, from nothing, when the connection is lost', () => {
    const { deps, rows } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive(
      withOthers(
        'lobby',
        [{ id: 3, name: 'Cook' }],
        [
          { id: 7, kills: 2, deaths: 0, assists: 0 },
          { id: 3, kills: 0, deaths: 2, assists: 0 },
        ],
      ),
    );
    latestSocket().close();
    expect(rows().map((r) => [r.id, r.kills, r.deaths, r.assists, r.isSelf])).toEqual([
      [-1, 0, 0, 0, true],
    ]);
    mp.close();
  });

  it('starts over from the new welcome of a reconnect', () => {
    const { deps, rows } = setup('lobby');
    const mp = new Multiplayer(deps);
    latestSocket().open();
    latestSocket().receive({
      ...welcome('lobby'),
      scores: [{ id: 7, kills: 5, deaths: 0, assists: 0 }],
    });
    expect(rows().map((r) => r.kills)).toEqual([5]);
    latestSocket().close();
    vi.runOnlyPendingTimers();
    latestSocket().open();
    latestSocket().receive(welcome('lobby'));
    expect(rows().map((r) => [r.id, r.kills])).toEqual([[7, 0]]);
    mp.close();
  });
});
