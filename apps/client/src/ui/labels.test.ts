import { describe, expect, it } from 'vitest';
import { clearOfInterface, declutterLabels, type LabelBox } from './labels.ts';

function box(x: number, y: number, distance: number, options: Partial<LabelBox> = {}): LabelBox {
  return {
    declutter: 'yield',
    pinned: false,
    width: 100,
    height: 24,
    x,
    y,
    drop: 0,
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

  it('keeps labels a few pixels apart, so neighbors never touch', () => {
    expect(run([box(100, 100, 3), box(202, 100, 6)])).toEqual([1, 0]);
    expect(run([box(100, 100, 3), box(100, 128, 6)])).toEqual([1, 0]);
    expect(run([box(100, 100, 3), box(210, 100, 6)])).toEqual([1, 1]);
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

  it("counts a station label's leader as part of it, down to its pin", () => {
    // A near label's leader runs down across a far label's words: the far one gives way.
    const near = box(100, 100, 3, { drop: 80 });
    const across = box(110, 150, 8);
    expect(run([near, across])).toEqual([1, 0]);
    // Below the pin, or clear of the line to one side, it stays.
    const below = box(100, 210, 8);
    const beside = box(170, 150, 8);
    expect(run([box(100, 100, 3, { drop: 80 }), below, beside])).toEqual([1, 1, 1]);
  });

  it('keeps a near label whose words cross a far leader, and hides the far one', () => {
    const far = box(100, 60, 8, { drop: 60 });
    const near = box(130, 100, 3);
    expect(run([far, near])).toEqual([0, 1]);
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

describe('clearOfInterface', () => {
  // The player list in the top right corner of a 1440 by 900 window.
  const players = { left: 1240, top: 36, right: 1404, bottom: 92 };

  function clear(labels: LabelBox[], boxes = [players]): number[] {
    clearOfInterface(labels, boxes);
    return labels.map((l) => l.opacity);
  }

  it('hides a label that would print over the interface, and leaves one clear of it alone', () => {
    // Bottom-center anchors: the first label's words reach up into the list, the second's do not.
    expect(clear([box(1300, 100, 6), box(1300, 140, 6)])).toEqual([0, 1]);
  });

  it('hides name tags and the pinned label too: words over words can be read as neither', () => {
    const tag = box(1200, 80, 4, { declutter: 'hold' });
    const pinned = box(1380, 120, 3, { pinned: true });
    expect(clear([tag, pinned])).toEqual([0, 0]);
  });

  it("counts a label's leader, down to its pin", () => {
    // The words sit just left of the list; the leader drops straight down beside them.
    expect(clear([box(1180, 30, 6, { drop: 50 })])).toEqual([1]);
    expect(clear([box(1250, 30, 6, { width: 20, drop: 50 })])).toEqual([0]);
  });

  it('keeps a few pixels between a label and the interface', () => {
    // Its right edge (1235) is 5 px from the list: closer than the gap labels keep from each other.
    expect(clear([box(1185, 80, 6)])).toEqual([0]);
    expect(clear([box(1175, 80, 6)])).toEqual([1]);
  });

  it('ignores parts of the interface that take no room, as hidden ones do', () => {
    expect(clear([box(1300, 100, 6)], [{ left: 0, top: 0, right: 0, bottom: 0 }])).toEqual([1]);
  });
});
