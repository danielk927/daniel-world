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
}

export type Declutter = 'yield' | 'hold';

const scratch = new Vector3();

function overlaps(a: LabelBox, b: LabelBox): boolean {
  // Labels hang above their anchor point, so compare the centers of their boxes.
  const aw = a.width * a.scale;
  const ah = a.height * a.scale;
  const bw = b.width * b.scale;
  const bh = b.height * b.scale;
  return (
    Math.abs(a.x - b.x) < (aw + bw) / 2 && Math.abs(a.y - ah / 2 - (b.y - bh / 2)) < (ah + bh) / 2
  );
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
 */
export class LabelLayer {
  readonly element: HTMLElement;
  private readonly labels: Label[] = [];
  private readonly order: number[] = [];
  private width = 1;
  private height = 1;

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
      scale: 1,
      distance: 0,
      opacity: 0,
      lastX: NaN,
      lastY: NaN,
      lastScale: NaN,
      lastOpacity: -1,
      rank: 0,
      lastRank: -1,
    };
    this.labels.push(label);
    return label;
  }

  remove(label: Label): void {
    const index = this.labels.indexOf(label);
    if (index >= 0) this.labels.splice(index, 1);
    label.element.remove();
  }

  resize(): void {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
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
    if (x !== label.lastX || y !== label.lastY || scale !== label.lastScale) {
      label.lastX = x;
      label.lastY = y;
      label.lastScale = scale;
      label.element.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px) scale(${scale})`;
    }
  }
}
