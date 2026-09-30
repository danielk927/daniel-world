import {
  CHAT_MAX_LENGTH,
  DEFAULT_ROOM,
  NAME_MAX_LENGTH,
  ROOM_CODE_MAX_LENGTH,
} from './constants.ts';

// Control characters, zero-width and bidi-override characters that could break or spoof the UI.
// Built from code points so no invisible characters appear in the source.
const UNSAFE_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x202a, 0x202e],
  [0x2060, 0x2069],
  [0xfeff, 0xfeff],
];
const hex = (n: number): string => `\\u${n.toString(16).padStart(4, '0')}`;
const UNSAFE_CHARS = new RegExp(
  `[${UNSAFE_RANGES.map(([from, to]) => `${hex(from)}-${hex(to)}`).join('')}]`,
  'g',
);

function cleanText(raw: string, maxLength: number): string {
  const cleaned = raw.replace(UNSAFE_CHARS, '').replace(/\s+/g, ' ').trim();
  // Slice by code points so an emoji is never cut in half.
  return Array.from(cleaned).slice(0, maxLength).join('').trim();
}

/** Display name as shown to everyone. Empty if nothing usable is left. */
export function sanitizeName(raw: string): string {
  return cleanText(raw, NAME_MAX_LENGTH);
}

/** Chat message text. Empty if nothing usable is left. */
export function sanitizeChat(raw: string): string {
  return cleanText(raw, CHAT_MAX_LENGTH);
}

/** Room codes are case-insensitive, `a-z0-9-`, and default to the public lobby. */
export function normalizeRoomCode(raw: string): string {
  const code = raw
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, ROOM_CODE_MAX_LENGTH);
  return code === '' ? DEFAULT_ROOM : code;
}
