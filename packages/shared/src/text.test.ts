import { describe, expect, it } from 'vitest';
import { CHAT_MAX_LENGTH, NAME_MAX_LENGTH } from './constants.ts';
import { normalizeRoomCode, sanitizeChat, sanitizeName } from './text.ts';

describe('sanitizeName', () => {
  it('trims, collapses whitespace and strips control characters', () => {
    expect(sanitizeName('  Brave \n\t Otter\u0007 ')).toBe('Brave Otter');
    expect(sanitizeName('a‮b​c')).toBe('abc');
  });

  it('limits length without splitting emoji', () => {
    expect(sanitizeName('x'.repeat(50))).toHaveLength(NAME_MAX_LENGTH);
    const emoji = '🦊'.repeat(30);
    expect(Array.from(sanitizeName(emoji))).toHaveLength(NAME_MAX_LENGTH);
  });

  it('returns empty for whitespace only', () => {
    expect(sanitizeName(' \u0000 ')).toBe('');
  });
});

describe('sanitizeChat', () => {
  it('limits to the chat maximum', () => {
    expect(sanitizeChat('a'.repeat(500))).toHaveLength(CHAT_MAX_LENGTH);
  });

  it('keeps markup as plain text', () => {
    expect(sanitizeChat('<b>hi</b>')).toBe('<b>hi</b>');
  });
});

describe('normalizeRoomCode', () => {
  it('defaults to the lobby', () => {
    expect(normalizeRoomCode('')).toBe('lobby');
    expect(normalizeRoomCode('  !!! ')).toBe('lobby');
  });

  it('lowercases and keeps only safe characters', () => {
    expect(normalizeRoomCode(' Secret Base #1 ')).toBe('secret-base-1');
    expect(normalizeRoomCode('--a--b--')).toBe('a-b');
    expect(normalizeRoomCode('x'.repeat(40))).toHaveLength(24);
  });
});
