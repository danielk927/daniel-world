import { describe, expect, it } from 'vitest';
import { MAX_PLAYER_ROWS, listedPlayers } from './hud.ts';

describe('listedPlayers', () => {
  it('lists everyone while they fit', () => {
    expect(listedPlayers(1)).toBe(1);
    expect(listedPlayers(MAX_PLAYER_ROWS)).toBe(MAX_PLAYER_ROWS);
  });

  it('folds the rest into one last row once they do not', () => {
    expect(listedPlayers(MAX_PLAYER_ROWS + 1)).toBe(MAX_PLAYER_ROWS - 1);
    expect(listedPlayers(16)).toBe(MAX_PLAYER_ROWS - 1);
  });
});
