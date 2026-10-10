import { describe, expect, it } from 'vitest';
import { MAX_PLAYER_ROWS, listedPlayers, promptSentence, rowsThatFit } from './hud.ts';

describe('listedPlayers', () => {
  it('lists everyone while they fit', () => {
    expect(listedPlayers(1)).toBe(1);
    expect(listedPlayers(MAX_PLAYER_ROWS)).toBe(MAX_PLAYER_ROWS);
  });

  it('folds the rest into one last row once they do not', () => {
    expect(listedPlayers(MAX_PLAYER_ROWS + 1)).toBe(MAX_PLAYER_ROWS - 1);
    expect(listedPlayers(16)).toBe(MAX_PLAYER_ROWS - 1);
  });

  it('folds sooner when fewer rows fit', () => {
    expect(listedPlayers(4, 5)).toBe(4);
    expect(listedPlayers(14, 5)).toBe(4);
  });
});

describe('rowsThatFit', () => {
  it('counts the rows and the gaps between them', () => {
    // Five rows 21 px tall with four 6 px gaps take 129 px.
    expect(rowsThatFit(129, 21, 6)).toBe(5);
    expect(rowsThatFit(128, 21, 6)).toBe(4);
  });

  it('lists no more than the most, and never fewer than two', () => {
    expect(rowsThatFit(2000, 21, 6)).toBe(MAX_PLAYER_ROWS);
    expect(rowsThatFit(10, 21, 6)).toBe(2);
    expect(rowsThatFit(-40, 21, 6)).toBe(2);
  });
});

describe('promptSentence', () => {
  it('reads the action on screen as a full sentence', () => {
    expect(promptSentence('Open Products')).toBe('Press E to open Products');
    expect(promptSentence('Play DOOM')).toBe('Press E to play DOOM');
  });
});
