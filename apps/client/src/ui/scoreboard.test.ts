import { describe, expect, it } from 'vitest';
import { rankRows, type ScoreRow } from './scoreboard.ts';

const row = (id: number, kills = 0, deaths = 0, assists = 0, isSelf = false): ScoreRow => ({
  id,
  name: `Cook ${id}`,
  color: '#ffffff',
  kills,
  deaths,
  assists,
  isSelf,
});

const order = (rows: readonly ScoreRow[]): number[] => rankRows(rows).map((r) => r.id);

describe('rankRows', () => {
  it('puts the most kills first', () => {
    expect(order([row(1, 1), row(2, 5), row(3, 3)])).toEqual([2, 3, 1]);
  });

  it('puts the one who has been knocked out less first, among equal kills', () => {
    expect(order([row(1, 2, 4), row(2, 2, 1), row(3, 2, 2)])).toEqual([2, 3, 1]);
  });

  it('puts the most assists first, among equal kills and deaths', () => {
    expect(order([row(1, 2, 2, 0), row(2, 2, 2, 5), row(3, 2, 2, 1)])).toEqual([2, 3, 1]);
  });

  it('keeps those who tie in every way in the order they came into the room', () => {
    expect(order([row(9), row(4), row(7)])).toEqual([4, 7, 9]);
  });

  it('puts kills before deaths: a cook with more of both is still ahead', () => {
    expect(order([row(1, 2, 0), row(2, 3, 9)])).toEqual([2, 1]);
  });

  it('is a new list, and leaves the one it was given as it was', () => {
    const rows = [row(1, 0), row(2, 4)];
    const ranked = rankRows(rows);
    expect(ranked).not.toBe(rows);
    expect(rows.map((r) => r.id)).toEqual([1, 2]);
  });

  it('ranks a lone cook, and nobody', () => {
    expect(order([row(1, 0, 0, 0, true)])).toEqual([1]);
    expect(order([])).toEqual([]);
  });
});
