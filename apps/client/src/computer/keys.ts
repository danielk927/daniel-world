/**
 * Keyboard mapping for DOOM: KeyboardEvent.code to a DOOM key code (doomkeys.h) and the
 * character the key types, which DOOM reads for cheats and savegame names. Movement keys
 * send DOOM's arrow and strafe codes but still type their letter, so W walks forward and
 * "iddqd" still works.
 */

export interface DoomKey {
  /** DOOM key code, 1..255. */
  readonly key: number;
  /** Unshifted ASCII the key types, or 0. */
  readonly typed: number;
}

// doomkeys.h
const KEY_RIGHTARROW = 0xae;
const KEY_LEFTARROW = 0xac;
const KEY_UPARROW = 0xad;
const KEY_DOWNARROW = 0xaf;
const KEY_STRAFE_L = 0xa0;
const KEY_STRAFE_R = 0xa1;
const KEY_USE = 0xa2;
const KEY_FIRE = 0xa3;
const KEY_ESCAPE = 27;
const KEY_ENTER = 13;
const KEY_TAB = 9;
const KEY_BACKSPACE = 0x7f;
const KEY_PAUSE = 0xff;
const KEY_EQUALS = 0x3d;
const KEY_MINUS = 0x2d;
const KEY_RSHIFT = 0x80 + 0x36;
const KEY_RALT = 0x80 + 0x38;
const KEY_F1 = 0x80 + 0x3b;

const ascii = (c: string) => c.charCodeAt(0);
const plain = (c: string): DoomKey => ({ key: ascii(c), typed: ascii(c) });

function buildMap(): Record<string, DoomKey> {
  const map: Record<string, DoomKey> = {};
  for (let c = ascii('a'); c <= ascii('z'); c++) {
    map[`Key${String.fromCharCode(c).toUpperCase()}`] = { key: c, typed: c };
  }
  for (let d = 0; d <= 9; d++) map[`Digit${d}`] = plain(String(d));
  for (let f = 0; f < 10; f++) map[`F${f + 1}`] = { key: KEY_F1 + f, typed: 0 };
  Object.assign(map, {
    // Walk and turn with the arrows or WASD; A and D strafe, like every game since.
    ArrowUp: { key: KEY_UPARROW, typed: 0 },
    ArrowDown: { key: KEY_DOWNARROW, typed: 0 },
    ArrowLeft: { key: KEY_LEFTARROW, typed: 0 },
    ArrowRight: { key: KEY_RIGHTARROW, typed: 0 },
    KeyW: { key: KEY_UPARROW, typed: ascii('w') },
    KeyS: { key: KEY_DOWNARROW, typed: ascii('s') },
    KeyA: { key: KEY_STRAFE_L, typed: ascii('a') },
    KeyD: { key: KEY_STRAFE_R, typed: ascii('d') },
    Comma: { key: KEY_STRAFE_L, typed: ascii(',') },
    Period: { key: KEY_STRAFE_R, typed: ascii('.') },
    // Fire with Space or Ctrl, open doors with E (or F).
    Space: { key: KEY_FIRE, typed: ascii(' ') },
    ControlLeft: { key: KEY_FIRE, typed: 0 },
    ControlRight: { key: KEY_FIRE, typed: 0 },
    KeyE: { key: KEY_USE, typed: ascii('e') },
    KeyF: { key: KEY_USE, typed: ascii('f') },
    ShiftLeft: { key: KEY_RSHIFT, typed: 0 },
    ShiftRight: { key: KEY_RSHIFT, typed: 0 },
    AltLeft: { key: KEY_RALT, typed: 0 },
    AltRight: { key: KEY_RALT, typed: 0 },
    Enter: { key: KEY_ENTER, typed: KEY_ENTER },
    NumpadEnter: { key: KEY_ENTER, typed: KEY_ENTER },
    Escape: { key: KEY_ESCAPE, typed: KEY_ESCAPE },
    Tab: { key: KEY_TAB, typed: KEY_TAB },
    Backspace: { key: KEY_BACKSPACE, typed: KEY_BACKSPACE },
    Pause: { key: KEY_PAUSE, typed: 0 },
    Minus: plain('-'),
    Equal: { key: KEY_EQUALS, typed: ascii('=') },
    NumpadSubtract: { key: KEY_MINUS, typed: ascii('-') },
    NumpadAdd: { key: KEY_EQUALS, typed: ascii('=') },
    Slash: plain('/'),
    Semicolon: plain(';'),
    Quote: plain("'"),
    BracketLeft: plain('['),
    BracketRight: plain(']'),
    Backslash: plain('\\'),
    Backquote: plain('`'),
  } satisfies Record<string, DoomKey>);
  return map;
}

/** Every KeyboardEvent.code the computer understands. */
export const DOOM_KEYS: Readonly<Record<string, DoomKey>> = buildMap();
