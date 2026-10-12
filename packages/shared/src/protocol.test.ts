import { describe, expect, it } from 'vitest';
import { ALL_KEYS, Keys, MAX_HEALTH, MAX_PLAYERS_PER_ROOM, PLAYER_COLORS } from './constants.ts';
import { COOLER_HITS_TO_OPEN } from './cooler.ts';
import {
  chefSpares,
  encode,
  parseClientMessage,
  parseServerMessage,
  samePrefs,
  type KillMessage,
  type ServerMessage,
  type WelcomeMessage,
} from './protocol.ts';

describe('parseClientMessage', () => {
  it('accepts valid messages', () => {
    expect(parseClientMessage('{"t":"hello","v":1,"name":"Otter","room":"lobby"}')).toEqual({
      t: 'hello',
      v: 1,
      name: 'Otter',
      room: 'lobby',
    });
    expect(
      parseClientMessage('{"t":"input","seq":5,"keys":17,"yaw":1.5,"pitch":-0.2}'),
    ).toMatchObject({
      t: 'input',
      seq: 5,
    });
  });

  it.each([
    ['not json', 'nope{'],
    ['non-string payload', 42],
    ['unknown type', '{"t":"teleport","x":1}'],
    ['missing fields', '{"t":"input","seq":1}'],
    ['bad key bits', '{"t":"input","seq":1,"keys":999,"yaw":0,"pitch":0}'],
    ['fractional seq', '{"t":"input","seq":1.5,"keys":0,"yaw":0,"pitch":0}'],
    ['pitch out of range', '{"t":"input","seq":1,"keys":0,"yaw":0,"pitch":3}'],
    ['huge chat', JSON.stringify({ t: 'chat', text: 'x'.repeat(501) })],
    ['an emote, which no longer exists', '{"t":"emote","emote":"wave"}'],
    ['an unknown room intent', '{"t":"hello","v":1,"name":"Otter","room":"x","intent":"take"}'],
    [
      'a spawn hint turned past any real turn',
      '{"t":"hello","v":1,"name":"O","room":"x","spawn":{"x":0,"z":0,"yaw":1.7e308}}',
    ],
    ['an input turned past any real turn', '{"t":"input","seq":1,"keys":0,"yaw":-2e6,"pitch":0}'],
    ['array', '[1,2,3]'],
    ['null', 'null'],
  ])('rejects %s', (_label, raw) => {
    expect(parseClientMessage(raw)).toBeNull();
  });

  it('accepts a hello that starts or joins a party', () => {
    for (const intent of ['start', 'join']) {
      expect(
        parseClientMessage(JSON.stringify({ t: 'hello', v: 1, name: 'O', room: 'x', intent })),
      ).toMatchObject({ intent });
    }
  });

  it('accepts a throw, with the tick its sender was seeing', () => {
    const input = {
      t: 'input',
      seq: 7,
      keys: Keys.Forward | Keys.Throw,
      yaw: 0,
      pitch: 0,
      view: 41.5,
    };
    expect(parseClientMessage(JSON.stringify(input))).toEqual(input);
    expect(ALL_KEYS & Keys.Throw).toBe(Keys.Throw);
    expect(parseClientMessage(JSON.stringify({ ...input, keys: ALL_KEYS + 1 }))).toBeNull();
    expect(parseClientMessage(JSON.stringify({ ...input, view: -1 }))).toBeNull();
  });

  it('strips unknown properties', () => {
    const parsed = parseClientMessage('{"t":"ping","id":3,"admin":true}');
    expect(parsed).toEqual({ t: 'ping', id: 3 });
  });

  it("carries the visitor's prefs in the hello, and on their own when they change", () => {
    const hello = { t: 'hello', v: 7, name: 'Otter', room: 'lobby', prefs: { chef: false } };
    expect(parseClientMessage(JSON.stringify(hello))).toEqual(hello);
    const prefs = { t: 'prefs', prefs: { chef: true } };
    expect(parseClientMessage(JSON.stringify(prefs))).toEqual(prefs);
    // Unknown prefs are dropped, as anywhere else.
    expect(
      parseClientMessage(JSON.stringify({ t: 'prefs', prefs: { chef: false, god: true } })),
    ).toEqual({ t: 'prefs', prefs: { chef: false } });
  });

  it.each([
    ['prefs without a body', '{"t":"prefs"}'],
    ['prefs missing the choice', '{"t":"prefs","prefs":{}}'],
    ['a choice that is not a boolean', '{"t":"prefs","prefs":{"chef":"off"}}'],
    ['a choice of 0', '{"t":"prefs","prefs":{"chef":0}}'],
    ['prefs that are not an object', '{"t":"prefs","prefs":[false]}'],
    ['a hello with bad prefs', '{"t":"hello","v":7,"name":"a","room":"b","prefs":{"chef":null}}'],
  ])('rejects %s', (_label, raw) => {
    expect(parseClientMessage(raw)).toBeNull();
  });
});

describe('parseServerMessage', () => {
  it('round trips a snapshot', () => {
    const snap = {
      t: 'snap' as const,
      tick: 10,
      players: [
        {
          id: 1,
          x: 1,
          y: 0,
          z: 2,
          vx: 0,
          vy: 0,
          vz: 0,
          yaw: 0.5,
          pitch: 0,
          grounded: true,
          dead: false,
          armed: true,
          ack: 9,
        },
      ],
    };
    expect(parseServerMessage(encode(snap))).toEqual(snap);
  });

  it('round trips the knife events', () => {
    const knife = { id: 3, x: 1, y: -0.04, z: 2, dx: 0, dy: -1, dz: 0 };
    const messages: ServerMessage[] = [
      { t: 'knife', id: 3, from: 1, seq: 40, x: 0, y: 1.6, z: 5, vx: 0, vy: 0, vz: -18 },
      { t: 'stuck', knife, at: 0.3 },
      { t: 'hit', knife: 5, from: 1, to: 2, health: 2, at: 0.12 },
      {
        t: 'kill',
        knife: 4,
        from: 1,
        to: 2,
        at: 0.12,
        scores: [
          { id: 1, kills: 1, deaths: 0, assists: 0 },
          { id: 2, kills: 0, deaths: 1, assists: 0 },
        ],
      },
    ];
    for (const message of messages) expect(parseServerMessage(encode(message))).toEqual(message);
    // A blade direction is a unit vector.
    expect(
      parseServerMessage(encode({ t: 'stuck', knife: { ...knife, dy: -3 }, at: 0.3 })),
    ).toBeNull();
  });

  it("marks the room's resident, and tells everyone each cook's prefs", () => {
    const prefs = { chef: true };
    const chef = { id: 1, name: 'Chef Skinner', color: '#ffffff', resident: true as const, prefs };
    expect(parseServerMessage(encode({ t: 'join', player: chef }))).toEqual({
      t: 'join',
      player: chef,
    });
    expect(
      parseServerMessage(JSON.stringify({ t: 'join', player: { ...chef, resident: false } })),
    ).toBeNull();
    const withoutPrefs = { id: 1, name: 'Chef Skinner', color: '#ffffff', resident: true };
    expect(parseServerMessage(JSON.stringify({ t: 'join', player: withoutPrefs }))).toBeNull();
    const changed = { t: 'prefs', id: 4, prefs: { chef: false } } as const;
    expect(parseServerMessage(encode(changed))).toEqual(changed);
    expect(parseServerMessage('{"t":"prefs","id":4,"prefs":{"chef":"no"}}')).toBeNull();
  });

  it('round trips a hit that leaves the cook standing, with the health they have left', () => {
    for (let health = 1; health < MAX_HEALTH; health++) {
      const hit = { t: 'hit', knife: 5, from: 1, to: 2, health, at: 0 } as const;
      expect(parseServerMessage(encode(hit))).toEqual(hit);
    }
  });

  it.each([
    ['no health left, which is a knockout', { health: 0 }],
    ['all the health there is, which is no hit at all', { health: MAX_HEALTH }],
    ['more health than there is', { health: MAX_HEALTH + 1 }],
    ['negative health', { health: -1 }],
    ['half a point of health', { health: 1.5 }],
    ['health that is not a number', { health: '2' }],
    ['no health', { health: undefined }],
    ['no victim', { to: undefined }],
    ['no thrower', { from: undefined }],
    ['no knife', { knife: undefined }],
    ['a flight time before the throw', { at: -0.1 }],
  ])('rejects a hit with %s', (_label, change) => {
    const hit = { t: 'hit', knife: 5, from: 1, to: 2, health: 2, at: 0.1, ...change };
    expect(parseServerMessage(JSON.stringify(hit))).toBeNull();
  });

  it("round trips every cook's tally, in the welcome and with a knockout", () => {
    const scores = [
      { id: 1, kills: 12, deaths: 3, assists: 0 },
      { id: 2, kills: 0, deaths: 0, assists: 7 },
    ];
    const welcome: WelcomeMessage = {
      t: 'welcome',
      v: 9,
      id: 1,
      room: 'lobby',
      tick: 3,
      players: [],
      self: {
        id: 1,
        x: 0,
        y: 0,
        z: 5.6,
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
      scores,
    };
    expect(parseServerMessage(encode(welcome))).toEqual(welcome);
    const kill: KillMessage = { t: 'kill', knife: 4, from: 1, to: 2, at: 0.12, scores };
    expect(parseServerMessage(encode(kill))).toEqual(kill);
    // Unknown properties of a tally are dropped, as anywhere else.
    const extra = { ...kill, scores: [{ ...scores[0], rank: 1 }] };
    expect(parseServerMessage(JSON.stringify(extra))).toEqual({ ...kill, scores: [scores[0]] });
    // A room holds no more cooks than there are places, so a tally for each is all there can be.
    const crowd = Array.from({ length: MAX_PLAYERS_PER_ROOM + 1 }, (_, id) => ({
      id,
      kills: 0,
      deaths: 0,
      assists: 0,
    }));
    expect(parseServerMessage(JSON.stringify({ ...kill, scores: crowd }))).toBeNull();
    expect(parseServerMessage(JSON.stringify({ ...welcome, scores: crowd }))).toBeNull();
  });

  it.each([
    ['a negative count', { kills: -1, deaths: 0, assists: 0 }],
    ['half a kill', { kills: 0.5, deaths: 0, assists: 0 }],
    ['counts that are not numbers', { kills: '1', deaths: 0, assists: 0 }],
    ['a tally without assists', { assists: undefined }],
    ['a tally without deaths', { deaths: undefined }],
    ['a tally without kills', { kills: undefined }],
    ['a tally of nobody', { id: undefined, kills: 0, deaths: 0, assists: 0 }],
    ['a tally of a negative id', { id: -3, kills: 0, deaths: 0, assists: 0 }],
  ])('rejects a knockout with %s', (_label, change) => {
    const kill = {
      t: 'kill',
      knife: 4,
      from: 1,
      to: 2,
      at: 0.12,
      scores: [{ id: 1, kills: 0, deaths: 0, assists: 0, ...change }],
    };
    expect(parseServerMessage(JSON.stringify(kill))).toBeNull();
  });

  it('rejects a knockout that says nothing of the score', () => {
    expect(
      parseServerMessage(JSON.stringify({ t: 'kill', knife: 4, from: 1, to: 2, at: 0.12 })),
    ).toBeNull();
  });

  it("round trips hits on the walk-in's door, and the welcome's door", () => {
    const punch = { t: 'cooler', from: 2, dent: { z: -3, y: 1.62, by: 'fist' } } as const;
    const knife = {
      t: 'cooler',
      from: 3,
      dent: { z: -2.5, y: 1.1, by: 'knife' },
      knife: { id: 7, at: 0.21 },
    } as const;
    const burst = { ...punch, openFrom: 412 };
    for (const message of [punch, knife, burst]) {
      expect(parseServerMessage(encode(message))).toEqual(message);
    }
    const dents = Array.from({ length: COOLER_HITS_TO_OPEN }, () => ({ ...punch.dent }));
    const welcome: WelcomeMessage = {
      t: 'welcome',
      v: 7,
      id: 1,
      room: 'lobby',
      tick: 3,
      players: [],
      self: {
        id: 1,
        x: 0,
        y: 0,
        z: 5.6,
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
      scores: [],
      cooler: { dents },
    };
    expect(parseServerMessage(encode(welcome))).toEqual(welcome);
    // An older server says nothing about the door.
    const untouched: WelcomeMessage = { ...welcome };
    delete untouched.cooler;
    expect(parseServerMessage(encode(untouched))).toEqual(untouched);
    // A door takes no more hits than it takes to open it.
    const tooMany = { ...welcome, cooler: { dents: [...dents, { ...punch.dent }] } };
    expect(parseServerMessage(encode(tooMany))).toBeNull();
  });

  it.each([
    ['a hit beside the door', { from: 1, dent: { z: 0, y: 1, by: 'fist' } }],
    ['a hit above the door', { from: 1, dent: { z: -3, y: 2.6, by: 'fist' } }],
    ['a hit by a kick', { from: 1, dent: { z: -3, y: 1, by: 'foot' } }],
    ['a hit without a place', { from: 1, dent: { by: 'fist' } }],
    ['a hit nobody made', { dent: { z: -3, y: 1, by: 'fist' } }],
    ['a negative input to open from', { from: 1, dent: { z: -3, y: 1, by: 'fist' }, openFrom: -1 }],
    ['a knife hit with no flight time', { from: 1, dent: { z: -3, y: 1, by: 'knife' }, knife: 2 }],
  ])("rejects %s on the walk-in's door", (_label, body) => {
    expect(parseServerMessage(JSON.stringify({ t: 'cooler', ...body }))).toBeNull();
  });

  it('rejects malformed colors', () => {
    expect(
      parseServerMessage(
        '{"t":"join","player":{"id":1,"name":"a","color":"red; background:url(x)"}}',
      ),
    ).toBeNull();
  });
});

describe('Chef Skinner and a cook who has turned him off', () => {
  const chef = { resident: true, prefs: { chef: true } };
  const off = { prefs: { chef: false } };
  const on = { prefs: { chef: true } };

  it("are out of each other's game, both ways", () => {
    expect(chefSpares(chef, off)).toBe(true);
    expect(chefSpares(off, chef)).toBe(true);
  });

  it('leave everyone else as they were', () => {
    expect(chefSpares(chef, on)).toBe(false);
    expect(chefSpares(on, chef)).toBe(false);
    expect(chefSpares(off, on)).toBe(false);
    expect(chefSpares(off, off)).toBe(false);
  });

  it('are told apart by every pref', () => {
    expect(samePrefs({ chef: true }, { chef: true })).toBe(true);
    expect(samePrefs({ chef: true }, { chef: false })).toBe(false);
  });
});

describe('PLAYER_COLORS', () => {
  it('has a distinct color per room slot', () => {
    expect(new Set(PLAYER_COLORS).size).toBe(MAX_PLAYERS_PER_ROOM);
  });
});
