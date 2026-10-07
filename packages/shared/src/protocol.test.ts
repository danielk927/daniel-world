import { describe, expect, it } from 'vitest';
import { ALL_KEYS, Keys, MAX_PLAYERS_PER_ROOM, PLAYER_COLORS } from './constants.ts';
import { encode, parseClientMessage, parseServerMessage } from './protocol.ts';

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
    const messages = [
      { t: 'knife', id: 3, from: 1, seq: 40, x: 0, y: 1.6, z: 5, vx: 0, vy: 0, vz: -18 },
      { t: 'stuck', knife, at: 0.3 },
      { t: 'kill', knife: 4, from: 1, to: 2, at: 0.12 },
    ] as const;
    for (const message of messages) expect(parseServerMessage(encode(message))).toEqual(message);
    // A blade direction is a unit vector.
    expect(
      parseServerMessage(encode({ t: 'stuck', knife: { ...knife, dy: -3 }, at: 0.3 })),
    ).toBeNull();
  });

  it('rejects malformed colors', () => {
    expect(
      parseServerMessage(
        '{"t":"join","player":{"id":1,"name":"a","color":"red; background:url(x)"}}',
      ),
    ).toBeNull();
  });
});

describe('PLAYER_COLORS', () => {
  it('has a distinct color per room slot', () => {
    expect(new Set(PLAYER_COLORS).size).toBe(MAX_PLAYERS_PER_ROOM);
  });
});
