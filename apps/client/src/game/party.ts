import {
  DEFAULT_ROOM,
  MAX_PLAYERS_PER_ROOM,
  ROOM_CODE_MAX_LENGTH,
  normalizeRoomCode,
  type ErrorCode,
} from '@world/shared';

/** Private rooms are parties; these are the rules for their codes and the links that share them. */

export type PartyCodeCheck =
  | { ok: true; code: string }
  | { ok: false; problem: 'empty' | 'characters' | 'too_long' | 'lobby'; message: string };

/**
 * A party code as typed: letters in either case, digits, dashes and spaces (which become dashes),
 * with a leading `#` allowed because that is how codes are shown. Anything else is refused rather
 * than quietly dropped, so the code a visitor shares is the one they typed.
 * A valid code is already normalized: `normalizeRoomCode(code) === code`.
 */
export function checkPartyCode(raw: string): PartyCodeCheck {
  const typed = raw.trim().replace(/^#/, '').trim();
  if (typed === '') {
    return { ok: false, problem: 'empty', message: 'Type a code, or roll a random one.' };
  }
  if (/[^a-z0-9\s-]/i.test(typed)) {
    return { ok: false, problem: 'characters', message: 'Use only letters, numbers and dashes.' };
  }
  const code = typed
    .toLowerCase()
    .replace(/[\s-]+/g, '-')
    .replace(/^-|-$/g, '');
  if (code === '') {
    return { ok: false, problem: 'characters', message: 'A code needs a letter or a number.' };
  }
  if (code.length > ROOM_CODE_MAX_LENGTH) {
    return {
      ok: false,
      problem: 'too_long',
      message: `Too long by ${code.length - ROOM_CODE_MAX_LENGTH}: codes have at most ${ROOM_CODE_MAX_LENGTH} characters.`,
    };
  }
  if (code === DEFAULT_ROOM) {
    return { ok: false, problem: 'lobby', message: 'That is the public lobby. Pick another code.' };
  }
  return { ok: true, code };
}

/** Digits and lowercase letters that cannot be mistaken for each other (no 0, 1, i, l or o). */
export const PARTY_CODE_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const RANDOM_CODE_LENGTH = 8;

/** A uniformly random integer in [0, bound), from the browser's cryptographic generator. */
function secureIndex(bound: number): number {
  // Reject the top sliver of the range so every index is equally likely.
  const limit = Math.floor(2 ** 32 / bound) * bound;
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value);
  while (value[0]! >= limit);
  return value[0]! % bound;
}

/**
 * A short code that reads aloud and types easily, like `h7kq-m3xp`, and is hard to guess: eight
 * characters from 31 is about 40 bits, so nobody wanders into a party by trying codes.
 */
export function randomPartyCode(index: (bound: number) => number = secureIndex): string {
  let code = '';
  for (let i = 0; i < RANDOM_CODE_LENGTH; i++) {
    if (i === RANDOM_CODE_LENGTH / 2) code += '-';
    code += PARTY_CODE_ALPHABET[index(PARTY_CODE_ALPHABET.length)];
  }
  return code;
}

/** The link that brings a friend straight to `room`: the site's root with `?room=`. */
export function inviteLink(room: string, siteRoot: string): string {
  const url = new URL(siteRoot);
  url.search = '';
  url.hash = '';
  url.searchParams.set('room', room);
  return url.href;
}

/**
 * This page's address while in `room`, for `history.replaceState`: `?room=` for a party, none for
 * the lobby, and every other parameter (like `?quality=`) left as it was.
 */
export function addressForRoom(href: string, room: string): string {
  const url = new URL(href);
  // Other parameters stay exactly as written: URLSearchParams would turn `time=20:00` into `20%3A00`.
  // Each part is still decoded to find the room, however its name is spelled (`r%6Fom=`).
  const kept = url.search
    .slice(1)
    .split('&')
    .filter((part) => part !== '' && !new URLSearchParams(part).has('room'));
  if (room !== DEFAULT_ROOM) kept.push(`room=${encodeURIComponent(room)}`);
  return `${url.pathname}${kept.length > 0 ? `?${kept.join('&')}` : ''}${url.hash}`;
}

/** The party a page address asks for, or null for the lobby (no parameter, or nothing usable). */
export function partyFromAddress(search: string): string | null {
  const raw = new URLSearchParams(search).get('room');
  if (raw === null) return null;
  const room = normalizeRoomCode(raw);
  return room === DEFAULT_ROOM ? null : room;
}

/** How a room is named to the visitor: the lobby, or a party by its code. */
export function roomName(room: string): string {
  return room === DEFAULT_ROOM ? 'the lobby' : `#${room}`;
}

export type JoinFailure = ErrorCode | 'unreachable' | 'cancelled';

/** Why moving into `room` did not work, in the visitor's words. */
export function joinFailureMessage(failure: JoinFailure, room: string): string {
  switch (failure) {
    case 'room_full':
      return room === DEFAULT_ROOM
        ? `The lobby is full right now (${MAX_PLAYERS_PER_ROOM} cooks). Try again in a moment.`
        : `#${room} is full: a party holds ${MAX_PLAYERS_PER_ROOM} cooks.`;
    case 'room_taken':
      return `Someone is already using #${room}. Join them, or pick another code.`;
    case 'no_room':
      return `Nobody is in #${room} yet. Check the code, or start the party yourself.`;
    case 'version':
      return 'Multiplayer is on a different version of the site right now. Reload the page to join a party.';
    case 'unreachable':
      return 'Could not reach the server. Try again in a moment.';
    default:
      return 'The server turned us away. Try again in a moment.';
  }
}
