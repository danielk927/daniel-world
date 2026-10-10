import { describe, expect, it } from 'vitest';
import { DOOM_KEYS } from './keys.ts';

const MODIFIERS: Record<string, readonly string[]> = {
  Ctrl: ['ControlLeft', 'ControlRight'],
  Alt: ['AltLeft', 'AltRight'],
  Shift: ['ShiftLeft', 'ShiftRight'],
  Meta: ['MetaLeft', 'MetaRight'],
};

/**
 * Shortcuts a page cannot cancel, even under pointer lock: Chrome keeps these for itself (closing,
 * opening and switching tabs and windows, quitting), and the system takes the Alt ones on Windows
 * and Linux (switching and closing windows, the window menu), as macOS takes Cmd+Tab.
 */
const UNCANCELLABLE: readonly (readonly string[])[] = [
  ['Ctrl', 'KeyW'],
  ['Ctrl', 'KeyT'],
  ['Ctrl', 'KeyN'],
  ['Ctrl', 'Tab'],
  ['Ctrl', 'PageUp'],
  ['Ctrl', 'PageDown'],
  ['Ctrl', 'Shift', 'KeyW'],
  ['Ctrl', 'Shift', 'KeyT'],
  ['Ctrl', 'Shift', 'KeyN'],
  ['Ctrl', 'Shift', 'KeyQ'],
  ['Ctrl', 'Shift', 'Tab'],
  ['Alt', 'Tab'],
  ['Alt', 'F4'],
  ['Alt', 'Space'],
  ['Alt', 'Escape'],
  ['Meta', 'KeyW'],
  ['Meta', 'KeyT'],
  ['Meta', 'KeyN'],
  ['Meta', 'KeyQ'],
  ['Meta', 'Tab'],
];

/** Can a player press this in the course of a game: is every key in it one DOOM plays with? */
function playable(shortcut: readonly string[]): boolean {
  return shortcut.every((key) => (MODIFIERS[key] ?? [key]).some((code) => code in DOOM_KEYS));
}

describe('DOOM_KEYS', () => {
  it('makes no shortcut the browser or the system keeps out of a held game key', () => {
    // Holding Ctrl to fire while walking on W closed the tab; holding Alt to strafe while opening
    // the map on Tab switched windows.
    expect(UNCANCELLABLE.filter(playable).map((keys) => keys.join('+'))).toEqual([]);
  });

  it('still walks, strafes, runs, opens doors and opens the map from the keyboard', () => {
    for (const code of ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'Space', 'KeyE', 'Tab']) {
      expect(DOOM_KEYS[code], code).toBeDefined();
    }
  });
});
