import { describe, expect, it } from 'vitest';
import { ROOM_CODE_MAX_LENGTH, normalizeRoomCode } from '@world/shared';
import {
  PARTY_CODE_ALPHABET,
  addressForRoom,
  checkPartyCode,
  inviteLink,
  joinFailureMessage,
  partyFromAddress,
  randomPartyCode,
} from './party.ts';

describe('checkPartyCode', () => {
  it.each([
    ['friday', 'friday'],
    ['  Friday Service ', 'friday-service'],
    ['#Secret-Base', 'secret-base'],
    ['a--b  c', 'a-b-c'],
    ['-edges-', 'edges'],
    ['x'.repeat(ROOM_CODE_MAX_LENGTH), 'x'.repeat(ROOM_CODE_MAX_LENGTH)],
  ])('accepts %j as %j, already normalized', (typed, code) => {
    expect(checkPartyCode(typed)).toEqual({ ok: true, code });
    expect(normalizeRoomCode(code)).toBe(code);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['#', 'empty'],
    ['pizza!', 'characters'],
    ['café', 'characters'],
    ['under_score', 'characters'],
    ['🍕', 'characters'],
    ['---', 'characters'],
    ['x'.repeat(ROOM_CODE_MAX_LENGTH + 3), 'too_long'],
    ['Lobby', 'lobby'],
  ])('refuses %j (%s) with a message', (typed, problem) => {
    const check = checkPartyCode(typed);
    expect(check).toMatchObject({ ok: false, problem });
    if (!check.ok) expect(check.message.length).toBeGreaterThan(0);
  });

  it('says how much too long a code is', () => {
    const check = checkPartyCode('x'.repeat(ROOM_CODE_MAX_LENGTH + 3));
    expect(!check.ok && check.message).toMatch(/Too long by 3/);
  });
});

describe('randomPartyCode', () => {
  it('reads as two groups of four unambiguous characters', () => {
    for (let i = 0; i < 200; i++) {
      const code = randomPartyCode();
      expect(code).toMatch(/^[2-9a-hjkmnp-z]{4}-[2-9a-hjkmnp-z]{4}$/);
      expect(checkPartyCode(code)).toEqual({ ok: true, code });
    }
  });

  it('draws every character from the whole alphabet', () => {
    let next = 0;
    const counting = (bound: number): number => next++ % bound;
    expect(randomPartyCode(counting)).toBe('2345-6789');
    expect(PARTY_CODE_ALPHABET).toHaveLength(31);
    expect(PARTY_CODE_ALPHABET).not.toMatch(/[01ilo]/);
  });

  it('rarely repeats', () => {
    const codes = new Set(Array.from({ length: 1000 }, () => randomPartyCode()));
    expect(codes.size).toBe(1000);
  });
});

describe('party addresses', () => {
  it('makes an invite link from the site root, dropping anything else', () => {
    expect(inviteLink('h7kq-m3xp', 'https://daniel.example/')).toBe(
      'https://daniel.example/?room=h7kq-m3xp',
    );
    expect(inviteLink('a', 'http://localhost:5173/?quality=high#x')).toBe(
      'http://localhost:5173/?room=a',
    );
  });

  it('puts the party in the address bar, and takes it out for the lobby', () => {
    expect(addressForRoom('https://d.example/?quality=high&time=20:00', 'friday')).toBe(
      '/?quality=high&time=20:00&room=friday',
    );
    expect(addressForRoom('https://d.example/?room=old', 'new')).toBe('/?room=new');
    expect(addressForRoom('https://d.example/?room=friday&quality=low', 'lobby')).toBe(
      '/?quality=low',
    );
    expect(addressForRoom('https://d.example/', 'lobby')).toBe('/');
    expect(addressForRoom('https://d.example/?room=a&room=b#top', 'c')).toBe('/?room=c#top');
    expect(addressForRoom('https://d.example/?r%6Fom=x&q=1', 'lobby')).toBe('/?q=1');
  });

  it('reads the party from an address', () => {
    expect(partyFromAddress('?room=Friday%20Service')).toBe('friday-service');
    expect(partyFromAddress('?room=lobby')).toBeNull();
    expect(partyFromAddress('?room=')).toBeNull();
    expect(partyFromAddress('?quality=high')).toBeNull();
  });
});

describe('joinFailureMessage', () => {
  it('names the party and says what to do', () => {
    expect(joinFailureMessage('room_taken', 'friday')).toMatch(/#friday.*Join them/);
    expect(joinFailureMessage('no_room', 'friday')).toMatch(/Nobody is in #friday/);
    expect(joinFailureMessage('room_full', 'friday')).toMatch(/#friday is full/);
    expect(joinFailureMessage('room_full', 'lobby')).toMatch(/lobby is full/);
    expect(joinFailureMessage('unreachable', 'friday')).toMatch(/reach the server/);
  });
});
