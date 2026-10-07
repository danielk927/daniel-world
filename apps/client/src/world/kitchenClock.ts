import {
  CanvasTexture,
  Color,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SRGBColorSpace,
  type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { at } from './builder.ts';

/**
 * The kitchen clock: a red LED display, the kind every pass has, showing the visitor's own local
 * time with the seconds running beside it (every second counts). Seven-segment digits, the unlit
 * segments faintly there as on a real display, the colon blinking each second.
 */

const WIDTH = 512;
const HEIGHT = 128;
const LIT = '#ff3d1f';
const UNLIT = '#2b0f0b';
const FACE = '#0c0a0a';

/** Which of the seven segments (a to g) each digit lights. */
const DIGITS = [
  0b1111110, 0b0110000, 0b1101101, 0b1111001, 0b0110011, 0b1011011, 0b1011111, 0b1110000, 0b1111111,
  0b1111011,
];

/** Segments as bars in a unit cell (width 1, height 2): x, y, horizontal. Order a to g. */
const SEGMENTS: readonly (readonly [number, number, boolean])[] = [
  [0.5, 0, true],
  [1, 0.5, false],
  [1, 1.5, false],
  [0.5, 2, true],
  [0, 1.5, false],
  [0, 0.5, false],
  [0.5, 1, true],
];

/** The visitor's clock face: 12 or 24 hours, as their locale writes the time. */
function uses12Hour(): boolean {
  const cycle = new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions().hourCycle;
  return cycle === 'h12' || cycle === 'h11';
}

export interface ClockDisplay {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Turn about the vertical; 0 faces +Z. */
  readonly ry: number;
}

export class KitchenClock {
  readonly mesh: Mesh;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: CanvasTexture;
  private readonly twelveHour = uses12Hour();
  /** The second on show, so the face redraws only when it changes. */
  private shown = -1;
  /** Milliseconds to add to the real clock: nonzero when `?time=` pins the hour. */
  private readonly offset: number;

  /**
   * `width` and `height` are the display's size in meters. `pinned` is a fixed starting hour, for
   * trying the look at another time of day; the clock then runs on from it. `hdr` lets the lit
   * segments shine past white so the bloom catches them, dimly.
   */
  constructor(
    displays: readonly ClockDisplay[],
    width: number,
    height: number,
    pinned: number | null,
    hdr: boolean,
  ) {
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    this.ctx = canvas.getContext('2d')!;
    this.texture = new CanvasTexture(canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 4;
    const now = new Date();
    this.offset =
      pinned === null
        ? 0
        : new Date(now).setHours(Math.floor(pinned), Math.round((pinned % 1) * 60), 0, 0) -
          now.getTime();
    const plane = new PlaneGeometry(width, height);
    const faces: BufferGeometry[] = displays.map((d) =>
      plane.clone().applyMatrix4(at(d.x, d.y, d.z, { ry: d.ry })),
    );
    this.mesh = new Mesh(
      mergeGeometries(faces),
      new MeshBasicMaterial({
        map: this.texture,
        color: new Color(1, 1, 1).multiplyScalar(hdr ? 1.5 : 1),
      }),
    );
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
    this.update();
  }

  /** Call every frame; it only redraws when the second changes. */
  update(): void {
    const ms = Date.now() + this.offset;
    const second = Math.floor(ms / 1000);
    if (second === this.shown) return;
    this.shown = second;
    const now = new Date(ms);
    this.draw(now.getHours(), now.getMinutes(), now.getSeconds());
    this.texture.needsUpdate = true;
  }

  private draw(hours: number, minutes: number, seconds: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = FACE;
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    let h = hours;
    if (this.twelveHour) h = hours % 12 || 12;
    const big = { w: 52, h: 92, t: 11, y: 18 };
    const small = { w: 30, h: 50, t: 7, y: 60 };
    const x0 = 26;
    // Hours, with the leading 1 of a 12-hour clock dark rather than a zero.
    this.digit(x0, big, h >= 10 || !this.twelveHour ? Math.floor(h / 10) : -1);
    this.digit(x0 + 76, big, h % 10);
    this.colon(x0 + 150, big, seconds % 2 === 0);
    this.digit(x0 + 182, big, Math.floor(minutes / 10));
    this.digit(x0 + 258, big, minutes % 10);
    this.digit(x0 + 346, small, Math.floor(seconds / 10));
    this.digit(x0 + 392, small, seconds % 10);
    if (this.twelveHour) {
      // AM and PM lamps above the seconds, the one that applies lit.
      ctx.font = '600 15px Jost, sans-serif';
      ctx.textBaseline = 'middle';
      const pm = hours >= 12;
      for (const [label, x, on] of [
        ['AM', x0 + 338, !pm],
        ['PM', x0 + 390, pm],
      ] as const) {
        ctx.fillStyle = on ? LIT : UNLIT;
        ctx.fillRect(x, 26, 8, 8);
        ctx.fillText(label, x + 12, 31);
      }
    }
  }

  /** One seven-segment digit, its cell's top-left at (x, size.y); -1 draws it all unlit. */
  private digit(
    x: number,
    size: { w: number; h: number; t: number; y: number },
    value: number,
  ): void {
    const ctx = this.ctx;
    const mask = value >= 0 ? DIGITS[value]! : 0;
    const half = size.h / 2;
    SEGMENTS.forEach(([sx, sy, horizontal], i) => {
      const on = (mask >> (6 - i)) & 1;
      ctx.fillStyle = on ? LIT : UNLIT;
      const cx = x + sx * size.w;
      const cy = size.y + sy * half;
      const length = (horizontal ? size.w : half) - size.t * 0.6;
      const t = size.t / 2;
      // A long hexagon: pointed ends, so neighbouring segments meet in a mitre.
      ctx.beginPath();
      if (horizontal) {
        ctx.moveTo(cx - length / 2, cy);
        ctx.lineTo(cx - length / 2 + t, cy - t);
        ctx.lineTo(cx + length / 2 - t, cy - t);
        ctx.lineTo(cx + length / 2, cy);
        ctx.lineTo(cx + length / 2 - t, cy + t);
        ctx.lineTo(cx - length / 2 + t, cy + t);
      } else {
        ctx.moveTo(cx, cy - length / 2);
        ctx.lineTo(cx + t, cy - length / 2 + t);
        ctx.lineTo(cx + t, cy + length / 2 - t);
        ctx.lineTo(cx, cy + length / 2);
        ctx.lineTo(cx - t, cy + length / 2 - t);
        ctx.lineTo(cx - t, cy - length / 2 + t);
      }
      ctx.closePath();
      ctx.fill();
    });
  }

  private colon(x: number, size: { h: number; y: number }, on: boolean): void {
    this.ctx.fillStyle = on ? LIT : UNLIT;
    for (const f of [0.32, 0.68]) this.ctx.fillRect(x - 5, size.y + size.h * f - 5, 10, 10);
  }
}
