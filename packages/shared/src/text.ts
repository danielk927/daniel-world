import {
  CHAT_MAX_LENGTH,
  DEFAULT_ROOM,
  NAME_MAX_LENGTH,
  ROOM_CODE_MAX_LENGTH,
} from './constants.ts';

// Control, format (zero-width, bidi overrides, soft hyphen) and default-ignorable characters that
// could break or spoof the UI, plus blank-looking fillers that are none of those (braille blank).
const UNSAFE_CHARS = new RegExp(
  `[\\p{Cc}\\p{Cf}\\p{Default_Ignorable_Code_Point}${String.fromCodePoint(0x2800)}]`,
  'gu',
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
