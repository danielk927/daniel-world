import { Vector3, type PerspectiveCamera } from 'three';

/** What decluttering needs to know about a label: its box on screen and its priority. */
export interface LabelBox {
  /**
   * How the label behaves when labels overlap on screen. A `yield` label hides when it overlaps a
   * nearer label that is showing; `hold` labels (name tags) always show.
   */
  declutter: Declutter;
  /** A pinned label always shows, whatever its kind (the station under the crosshair). */
  pinned: boolean;
  /** Layout size in CSS pixels. */
  width: number;
  height: number;
  /** This frame's projected state: bottom-center anchor point, scale, distance and opacity. */
  x: number;
  y: number;
  /**
   * How far below its bottom the label reaches on screen, in CSS pixels: a raised label's leader
   * line and pin, down to the point it names. Part of the label when labels make way for each other.
   */
  drop: number;
  scale: number;
  distance: number;
  opacity: number;
  /** Stacking order this frame: 0 for the farthest showing label, so nearer labels draw on top. */
  rank: number;
}

export interface Label extends LabelBox {
  readonly element: HTMLElement;
  readonly anchor: Vector3;
  offsetY: number;
  maxDistance: number;
  /** Whether width and height have been measured (a layout read, so only once). */
  measured: boolean;
  /** Last written style values, so unchanged labels cost no DOM writes. */
  lastX: number;
  lastY: number;
  lastScale: number;
  lastOpacity: number;
  lastRank: number;
  /** The leader's length in the label's own (unscaled) pixels, as last written to `--leader`. */
  lastLeader: number;
  /** How much of the leader shows, as last written to `--leader-alpha`. */
  leaderAlpha: number;
  lastLeaderAlpha: number;
}

export type Declutter = 'yield' | 'hold';

/** A box on screen, in CSS pixels. */
export interface ScreenBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A part of the interface labels make way for, where it was last measured. */
interface ClearBox extends ScreenBox {
  readonly element: HTMLElement;
  /** Whether it shows now; one faded out keeps its size but needs no room. */
  readonly showing: () => boolean;
}

const scratch = new Vector3();
const pin = new Vector3();
/** Half the width a leader and its pin take on screen, in CSS pixels. */
const LEADER_HALF_WIDTH = 5;
/** The least room between two labels' words, so neighbors never touch. */
const LABEL_GAP = 6;
/**
 * A leader shows in full up to this share of the screen's height, and fades out by the next: close
 * to a station it would cut across the view, and the label plainly names what is under it anyway.
 */
const LEADER_FULL = 0.07;
const LEADER_GONE = 0.125;

function boxesOverlap(
  ax: number,
  ahw: number,
  aTop: number,
  aBottom: number,
  bx: number,
  bhw: number,
  bTop: number,
  bBottom: number,
): boolean {
  return Math.abs(ax - bx) < ahw + bhw && aTop < bBottom && bTop < aBottom;
}

/** Labels hang above their anchor point, and a raised label's leader hangs below it, as a strip. */
function overlaps(a: LabelBox, b: LabelBox): boolean {
  const ahw = (a.width * a.scale) / 2;
  const bhw = (b.width * b.scale) / 2;
  const aTop = a.y - a.height * a.scale;
  const bTop = b.y - b.height * b.scale;
  const gap = LABEL_GAP / 2;
  return (
    boxesOverlap(a.x, ahw + gap, aTop - gap, a.y + gap, b.x, bhw + gap, bTop - gap, b.y + gap) ||
    (a.drop > 0 && boxesOverlap(a.x, LEADER_HALF_WIDTH, a.y, a.y + a.drop, b.x, bhw, bTop, b.y)) ||
    (b.drop > 0 && boxesOverlap(b.x, LEADER_HALF_WIDTH, b.y, b.y + b.drop, a.x, ahw, aTop, a.y))
  );
}

/** Whether a label's words, or its leader down to its pin, reach into `box`, or within a gap of it. */
function overInterface(a: LabelBox, box: ScreenBox): boolean {
  const hw = (a.width * a.scale) / 2;
  const top = a.y - a.height * a.scale;
  const x = (box.left + box.right) / 2;
  const half = (box.right - box.left) / 2;
  return (
    boxesOverlap(
      a.x,
      hw + LABEL_GAP,
      top - LABEL_GAP,
      a.y + LABEL_GAP,
      x,
      half,
      box.top,
      box.bottom,
    ) ||
    (a.drop > 0 &&
      boxesOverlap(a.x, LEADER_HALF_WIDTH, a.y, a.y + a.drop, x, half, box.top, box.bottom))
  );
}

/**
 * Hide every label, whatever its kind, that would show over a part of the interface: the room, the
 * players, the controls, the map. Words over words can be read as neither, and nothing may sit
 * behind words in the world to set them apart. Parts that take no room (hidden ones) are skipped.
 */
export function clearOfInterface(labels: readonly LabelBox[], boxes: readonly ScreenBox[]): void {
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!;
    if (label.opacity === 0) continue;
    for (let k = 0; k < boxes.length; k++) {
      const box = boxes[k]!;
      if (box.right <= box.left || box.bottom <= box.top) continue;
      if (overInterface(label, box)) {
        label.opacity = 0;
        break;
      }
    }
  }
}

/**
 * Hide `yield` labels that would overlap a nearer label. Labels are placed nearest first, so a label
 * only ever gives way to one that is actually showing. `order` is scratch space for the sort, reused
 * across frames so this never allocates. A few dozen labels, so insertion sort and O(n²) are fine.
 */
export function declutterLabels(labels: readonly LabelBox[], order: number[]): void {
  order.length = 0;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i]!.opacity === 0) continue;
    let k = order.length;
    order.push(i);
    while (k > 0 && labels[order[k - 1]!]!.distance > labels[i]!.distance) {
      order[k] = order[k - 1]!;
      k--;
    }
    order[k] = i;
  }
  for (let n = 0; n < order.length; n++) labels[order[n]!]!.rank = order.length - n;
  // Pinned and `hold` labels always show. A `yield` label gives way to any nearer label that is
  // showing, and to the pinned label wherever it is.
  for (let n = 0; n < order.length; n++) {
    const a = labels[order[n]!]!;
    if (a.pinned || a.declutter === 'hold') continue;
    for (let m = 0; m < order.length; m++) {
      const b = labels[order[m]!]!;
      if (a === b || b.opacity === 0) continue;
      const blocks = b.pinned || m < n;
      if (blocks && overlaps(a, b)) {
        a.opacity = 0;
        break;
      }
    }
  }
}

/**
 * DOM labels pinned to points in the world (name tags, object titles). DOM text stays crisp at any
 * resolution and costs no draw calls. Positions update every frame without allocating.
 *
 * A label raised above its anchor (`offsetY`) hangs a leader down to it: the layer works out how
 * long that is on screen and hands it to the stylesheet as `--leader`, in the label's own pixels,
 * with `--leader-alpha` to fade out a leader that close up would be long.
 */
export class LabelLayer {
  readonly element: HTMLElement;
  private readonly labels: Label[] = [];
  private readonly order: number[] = [];
  private width = 1;
  private height = 1;
  /** Parts of the interface labels make way for, and those showing this frame (scratch). */
  private readonly clear: ClearBox[] = [];
  private readonly clearShowing: ClearBox[] = [];
  /** Measures them again whenever one changes size, so a frame never reads the layout. */
  private readonly clearObserver = new ResizeObserver(() => this.measureClear());

  private readonly camera: PerspectiveCamera;
  /** Whether something solid hides a point from the camera; a hidden label does not show. */
  hides: ((camera: Vector3, point: Vector3) => boolean) | null = null;

  constructor(parent: HTMLElement, camera: PerspectiveCamera) {
    this.camera = camera;
    this.element = document.createElement('div');
    this.element.className = 'labels';
    this.element.setAttribute('aria-hidden', 'true');
    parent.append(this.element);
    this.resize();
    // Sizes measured before the web fonts arrived are too small; measure again once they have.
    const remeasure = (): void => {
      for (const label of this.labels) label.measured = false;
    };
    void document.fonts.ready.then(remeasure);
    document.fonts.addEventListener('loadingdone', remeasure);
  }

  add(
    element: HTMLElement,
    anchor: Vector3,
    offsetY: number,
    maxDistance: number,
    declutter: Declutter = 'hold',
  ): Label {
    element.classList.add('label');
    this.element.append(element);
    const label: Label = {
      element,
      anchor,
      offsetY,
      maxDistance,
      declutter,
      pinned: false,
      measured: false,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      drop: 0,
      scale: 1,
      distance: 0,
      opacity: 0,
      lastX: NaN,
      lastY: NaN,
      lastScale: NaN,
      lastOpacity: -1,
      rank: 0,
      lastRank: -1,
      lastLeader: 0,
      leaderAlpha: 0,
      lastLeaderAlpha: 0,
    };
    this.labels.push(label);
    return label;
  }

  /**
   * Labels never show over `element`, a part of the interface, while `showing` says it shows. Its
   * box is measured when it or any other part changes size, and when the window does.
   */
  keepClear(element: HTMLElement, showing: () => boolean = () => true): void {
    this.clear.push({ element, showing, left: 0, top: 0, right: 0, bottom: 0 });
    this.clearObserver.observe(element);
  }

  private measureClear(): void {
    for (const box of this.clear) {
      const rect = box.element.getBoundingClientRect();
      box.left = rect.left;
      box.top = rect.top;
      box.right = rect.right;
      box.bottom = rect.bottom;
    }
  }

  remove(label: Label): void {
    const index = this.labels.indexOf(label);
    if (index >= 0) this.labels.splice(index, 1);
    label.element.remove();
  }

  resize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.measureClear();
  }

  update(): void {
    // Hidden labels measure 0 by 0, and a label is only measured once, so measuring now would leave
    // it too small to ever give way to another.
    if (this.element.hidden) return;
    const camPos = this.camera.position;
    for (let i = 0; i < this.labels.length; i++) {
      const label = this.labels[i]!;
      scratch.copy(label.anchor);
      scratch.y += label.offsetY;
      const distance = scratch.distanceTo(camPos);
      if (this.hides?.(camPos, scratch)) {
        label.distance = distance;
        label.opacity = 0;
        continue;
      }
      scratch.project(this.camera);
      const onScreen =
        distance < label.maxDistance &&
        scratch.z < 1 &&
        Math.abs(scratch.x) < 1.2 &&
        Math.abs(scratch.y) < 1.2;
      label.distance = distance;
      if (!onScreen) {
        label.opacity = 0;
        continue;
      }
      label.x = Math.round((scratch.x * 0.5 + 0.5) * this.width * 2) / 2;
      label.y = Math.round((-scratch.y * 0.5 + 0.5) * this.height * 2) / 2;
      label.drop = 0;
      label.leaderAlpha = 0;
      if (label.offsetY > 0) {
        pin.copy(label.anchor).project(this.camera);
        const drop = Math.round((-pin.y * 0.5 + 0.5) * this.height * 2) / 2 - label.y;
        const full = LEADER_FULL * this.height;
        const gone = LEADER_GONE * this.height;
        if (pin.z < 1 && drop > 0 && drop < gone) {
          label.drop = drop;
          label.leaderAlpha = Math.round(Math.min(1, (gone - drop) / (gone - full)) * 20) / 20;
        }
      }
      label.opacity =
        Math.round(Math.min(1, (label.maxDistance - distance) / (label.maxDistance * 0.25)) * 50) /
        50;
      label.scale = Math.round(Math.max(0.7, Math.min(1.1, 9 / Math.max(distance, 1))) * 200) / 200;
    }
    this.declutter();
    for (let i = 0; i < this.labels.length; i++) this.write(this.labels[i]!);
  }

  private declutter(): void {
    for (let i = 0; i < this.labels.length; i++) {
      const label = this.labels[i]!;
      if (label.opacity > 0 && !label.measured) {
        label.measured = true;
        label.width = label.element.offsetWidth;
        label.height = label.element.offsetHeight;
      }
    }
    this.clearShowing.length = 0;
    for (let i = 0; i < this.clear.length; i++) {
      const box = this.clear[i]!;
      if (box.showing()) this.clearShowing.push(box);
    }
    clearOfInterface(this.labels, this.clearShowing);
    declutterLabels(this.labels, this.order);
  }

  private write(label: Label): void {
    if (label.opacity !== label.lastOpacity) {
      label.lastOpacity = label.opacity;
      label.element.style.opacity = String(label.opacity);
    }
    if (label.opacity === 0) return;
    if (label.rank !== label.lastRank) {
      label.lastRank = label.rank;
      label.element.style.zIndex = String(label.rank);
    }
    const { x, y, scale } = label;
    // Drawn inside the scaled label, so in its own pixels.
    const leader = Math.round((label.drop / scale) * 2) / 2;
    if (leader !== label.lastLeader) {
      label.lastLeader = leader;
      label.element.style.setProperty('--leader', `${leader}px`);
    }
    if (label.leaderAlpha !== label.lastLeaderAlpha) {
      label.lastLeaderAlpha = label.leaderAlpha;
      label.element.style.setProperty('--leader-alpha', String(label.leaderAlpha));
    }
    if (x !== label.lastX || y !== label.lastY || scale !== label.lastScale) {
      label.lastX = x;
      label.lastY = y;
      label.lastScale = scale;
      label.element.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px) scale(${scale})`;
    }
  }
}
