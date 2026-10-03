import { describe, expect, it } from 'vitest';
import { declutterLabels, type LabelBox } from './labels.ts';

function box(x: number, y: number, distance: number, options: Partial<LabelBox> = {}): LabelBox {
  return {
    declutter: 'yield',
    pinned: false,
    width: 100,
    height: 24,
    x,
    y,
    scale: 1,
    distance,
    opacity: 1,
    rank: 0,
    ...options,
  };
}

function run(labels: LabelBox[]): number[] {
  declutterLabels(labels, []);
  return labels.map((l) => l.opacity);
}

describe('declutterLabels', () => {
  it('keeps the nearer of two overlapping station labels', () => {
    expect(run([box(100, 100, 6), box(140, 105, 3)])).toEqual([0, 1]);
  });

  it('leaves labels that do not overlap alone', () => {
    expect(run([box(100, 100, 6), box(300, 100, 3), box(100, 200, 4)])).toEqual([1, 1, 1]);
  });

  it('only gives way to labels that are actually showing', () => {
    // A (nearest) hides B; C overlaps B but not A, so C stays.
    const a = box(100, 100, 2);
    const b = box(180, 100, 4);
    const c = box(260, 100, 6);
    expect(run([c, b, a])).toEqual([1, 0, 1]);
  });

  it('never hides name tags, and nearer station labels still show over far ones', () => {
    const tag = box(100, 100, 20, { declutter: 'hold' });
    const station = box(110, 100, 3);
    expect(run([tag, station])).toEqual([1, 1]);
    const nearTag = box(100, 100, 2, { declutter: 'hold' });
    const farStation = box(110, 100, 8);
    expect(run([nearTag, farStation])).toEqual([1, 0]);
  });

  it('always shows a pinned label, hiding nearer ones in its way', () => {
    const near = box(100, 100, 2);
    const hovered = box(120, 100, 5, { pinned: true });
    expect(run([near, hovered])).toEqual([0, 1]);
  });

  it('compares boxes that hang above their anchors, so heights line up at the bottom', () => {
    // A tall name tag (with a chat bubble) reaches far above its anchor, not below it.
    const tall = box(100, 100, 2, { declutter: 'hold', height: 120 });
    const above = box(100, 30, 5);
    const below = box(100, 150, 5);
    expect(run([tall, above, below])).toEqual([1, 0, 1]);
  });

  it('stacks nearer labels above farther ones', () => {
    const labels = [box(100, 100, 9, { declutter: 'hold' }), box(400, 100, 2), box(700, 100, 5)];
    declutterLabels(labels, []);
    expect(labels.map((l) => l.rank)).toEqual([1, 3, 2]);
  });

  it('skips labels that are already hidden', () => {
    expect(run([box(100, 100, 2, { opacity: 0 }), box(110, 100, 5)])).toEqual([0, 1]);
  });
});
