import { describe, expect, it } from 'vitest';
import { MAX_PLAYERS_PER_ROOM, PLAYER_COLORS } from './constants.ts';
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
    expect(parseClientMessage('{"t":"emote","emote":"wave"}')).toEqual({
      t: 'emote',
      emote: 'wave',
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
    ['unknown emote', '{"t":"emote","emote":"backflip"}'],
    ['array', '[1,2,3]'],
    ['null', 'null'],
  ])('rejects %s', (_label, raw) => {
    expect(parseClientMessage(raw)).toBeNull();
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
          ack: 9,
        },
      ],
    };
    expect(parseServerMessage(encode(snap))).toEqual(snap);
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
