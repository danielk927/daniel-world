import { Vector3, type PerspectiveCamera } from 'three';

export interface Label {
  readonly element: HTMLElement;
  readonly anchor: Vector3;
  offsetY: number;
  maxDistance: number;
  visible: boolean;
}

const scratch = new Vector3();

/**
 * DOM labels pinned to points in the world (name tags, object titles). DOM text stays crisp at any
 * resolution and costs no draw calls. Positions update every frame without allocating.
 */
export class LabelLayer {
  readonly element: HTMLElement;
  private readonly labels: Label[] = [];
  private width = 1;
  private height = 1;

  private readonly camera: PerspectiveCamera;

  constructor(parent: HTMLElement, camera: PerspectiveCamera) {
    this.camera = camera;
    this.element = document.createElement('div');
    this.element.className = 'labels';
    this.element.setAttribute('aria-hidden', 'true');
    parent.append(this.element);
    this.resize();
  }

  add(element: HTMLElement, anchor: Vector3, offsetY: number, maxDistance: number): Label {
    element.classList.add('label');
    this.element.append(element);
    const label: Label = { element, anchor, offsetY, maxDistance, visible: true };
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
    const camPos = this.camera.position;
    for (const label of this.labels) {
      scratch.copy(label.anchor);
      scratch.y += label.offsetY;
      const distance = scratch.distanceTo(camPos);
      scratch.project(this.camera);
      const onScreen =
        label.visible &&
        distance < label.maxDistance &&
        scratch.z < 1 &&
        Math.abs(scratch.x) < 1.2 &&
        Math.abs(scratch.y) < 1.2;
      if (!onScreen) {
        if (label.element.style.opacity !== '0') label.element.style.opacity = '0';
        continue;
      }
      const x = (scratch.x * 0.5 + 0.5) * this.width;
      const y = (-scratch.y * 0.5 + 0.5) * this.height;
      const fade = Math.min(1, (label.maxDistance - distance) / (label.maxDistance * 0.25));
      const scale = Math.max(0.7, Math.min(1.1, 9 / Math.max(distance, 1)));
      label.element.style.opacity = fade.toFixed(2);
      label.element.style.transform = `translate(-50%, -100%) translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) scale(${scale.toFixed(3)})`;
    }
  }
}
