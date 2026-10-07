import {
  COOLER,
  COOLER_SHELVES,
  COOLER_WALL,
  DOORS,
  KITCHEN,
  ROOM_HALF_X,
  ROOM_HALF_Z,
  STATIONS,
  type Footprint,
} from '@world/shared';
import { el } from './dom.ts';

/** CSS size of the map, in pixels. The kitchen fills it with a margin. */
const MARGIN = 8;
export const MAP_WIDTH = 176;

/** Where the map's middle is, in pixels, and how many pixels a meter is. */
interface MapView {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

/** A view fitting `extent` across the map's width, centered. */
function viewOf(extent: Footprint, height: number): MapView {
  const scale = (MAP_WIDTH - MARGIN * 2) / (extent.maxX - extent.minX);
  return {
    scale,
    x: MAP_WIDTH / 2 - ((extent.minX + extent.maxX) / 2) * scale,
    y: height / 2 - ((extent.minZ + extent.maxZ) / 2) * scale,
  };
}

const KITCHEN_EXTENT = {
  minX: -ROOM_HALF_X,
  maxX: ROOM_HALF_X,
  minZ: -ROOM_HALF_Z,
  maxZ: ROOM_HALF_Z,
};
const KITCHEN_SCALE = (MAP_WIDTH - MARGIN * 2) / (ROOM_HALF_X * 2);
export const MAP_HEIGHT = Math.round(ROOM_HALF_Z * 2 * KITCHEN_SCALE + MARGIN * 2);
/** The kitchen alone, filling the map; and with the walk-in cooler beside it, once it is open. */
const KITCHEN_VIEW = viewOf(KITCHEN_EXTENT, MAP_HEIGHT);
const COOLER_VIEW = viewOf({ ...KITCHEN_EXTENT, maxX: COOLER.maxX + COOLER_WALL }, MAP_HEIGHT);

/** How the map lays out the world: the kitchen alone, or with the open walk-in beside it. */
export function mapView(coolerOpen: boolean): MapView {
  return coolerOpen ? COOLER_VIEW : KITCHEN_VIEW;
}

/** World (x, z) to map pixels. North (-Z) is up. */
export function worldToMap(
  x: number,
  z: number,
  view: MapView = KITCHEN_VIEW,
): { x: number; y: number } {
  return { x: view.x + x * view.scale, y: view.y + z * view.scale };
}

function rect(ctx: CanvasRenderingContext2D, f: Footprint, view: MapView): void {
  const a = worldToMap(f.minX, f.minZ, view);
  ctx.fillRect(a.x, a.y, (f.maxX - f.minX) * view.scale, (f.maxZ - f.minZ) * view.scale);
}

function outline(ctx: CanvasRenderingContext2D, f: Footprint, view: MapView): void {
  const a = worldToMap(f.minX, f.minZ, view);
  ctx.strokeRect(a.x, a.y, (f.maxX - f.minX) * view.scale, (f.maxZ - f.minZ) * view.scale);
}

const FLOOR = '#9da2a5';
const WALL = 'rgba(244, 238, 228, 0.9)';

/** The kitchen as seen from above, and the walk-in cooler once it is open. Drawn when it changes. */
function drawKitchen(
  ctx: CanvasRenderingContext2D,
  stationColors: readonly string[],
  view: MapView,
  coolerOpen: boolean,
): void {
  const scale = view.scale;
  // Floor and walls.
  ctx.fillStyle = FLOOR;
  rect(ctx, KITCHEN_EXTENT, view);
  ctx.strokeStyle = WALL;
  ctx.lineWidth = 2;
  outline(ctx, KITCHEN_EXTENT, view);

  // Doors as warm gaps in the walls; the walk-in, once open, as a way through.
  ctx.fillStyle = '#ffc98c';
  for (const door of Object.values(DOORS)) {
    const span = (door.to - door.from) * scale;
    if (door.wall === 'north' || door.wall === 'south') {
      const a = worldToMap(door.from, door.wall === 'north' ? -ROOM_HALF_Z : ROOM_HALF_Z, view);
      ctx.fillRect(a.x, a.y - 1.5, span, 3);
    } else if (door !== DOORS.walkIn || !coolerOpen) {
      const a = worldToMap(door.wall === 'west' ? -ROOM_HALF_X : ROOM_HALF_X, door.from, view);
      ctx.fillRect(a.x - 1.5, a.y, 3, span);
    }
  }
  if (coolerOpen) {
    // The cold room: icy floor, its shelves, its walls, and the doorway open into it.
    const room = { minX: ROOM_HALF_X, maxX: COOLER.maxX, minZ: COOLER.minZ, maxZ: COOLER.maxZ };
    ctx.fillStyle = '#b3c3cc';
    rect(ctx, { ...room, minX: COOLER.minX }, view);
    ctx.fillStyle = '#d7e0e5';
    for (const shelf of COOLER_SHELVES) rect(ctx, shelf, view);
    ctx.strokeStyle = WALL;
    outline(ctx, { ...room, minX: COOLER.minX }, view);
    ctx.fillStyle = '#b3c3cc';
    const doorway = DOORS.walkIn;
    rect(
      ctx,
      { minX: ROOM_HALF_X - 0.12, maxX: COOLER.minX + 0.12, minZ: doorway.from, maxZ: doorway.to },
      view,
    );
  }

  // Counters and islands in steel, the cooking suite darker under its hood.
  const { piano, hood, ...counters } = KITCHEN;
  ctx.fillStyle = '#a9adb2';
  for (const f of Object.values(counters)) rect(ctx, f, view);
  ctx.fillStyle = 'rgba(201, 206, 211, 0.35)';
  rect(ctx, hood, view);
  ctx.fillStyle = '#5b636b';
  rect(ctx, piano, view);
  ctx.strokeStyle = '#d3dbe1';
  ctx.lineWidth = 1;
  outline(ctx, piano, view);

  // Stations as diamonds in their colors, so circles always mean players.
  STATIONS.forEach((station, i) => {
    const s = worldToMap(station.x, station.z, view);
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - 4);
    ctx.lineTo(s.x + 4, s.y);
    ctx.lineTo(s.x, s.y + 4);
    ctx.lineTo(s.x - 4, s.y);
    ctx.closePath();
    ctx.fillStyle = stationColors[i] ?? '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });
}

/**
 * Bird's-eye minimap in the corner: the kitchen, other players as colored dots, and the local
 * player as an arrow with a view cone. North is always up. The kitchen is rendered once to an
 * offscreen canvas; each frame only blits it and draws the players.
 */
export class Minimap {
  readonly element: HTMLElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly background: HTMLCanvasElement;
  private readonly dpr: number;
  /** View cone fill, created once; it is drawn in the arrow's local space. */
  private readonly cone: CanvasGradient;
  private readonly stationColors: readonly string[];
  /** The kitchen alone, or with the walk-in cooler beside it once that is open. */
  private view: MapView = KITCHEN_VIEW;
  private coolerOpen = false;

  constructor(parent: HTMLElement, stationColors: readonly string[]) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = el('canvas', {
      class: 'minimap-canvas',
      attrs: { role: 'img', 'aria-label': 'Minimap: you are the arrow, other players are dots' },
    });
    canvas.width = MAP_WIDTH * this.dpr;
    canvas.height = MAP_HEIGHT * this.dpr;
    canvas.style.width = `${MAP_WIDTH}px`;
    canvas.style.height = `${MAP_HEIGHT}px`;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.cone = this.ctx.createRadialGradient(0, 0, 0, 0, 0, 30);
    this.cone.addColorStop(0, 'rgba(255, 248, 240, 0.45)');
    this.cone.addColorStop(1, 'rgba(255, 248, 240, 0)');

    this.background = document.createElement('canvas');
    this.background.width = canvas.width;
    this.background.height = canvas.height;
    this.stationColors = stationColors;
    this.drawBackground();

    this.element = el('div', { class: 'minimap' }, [
      canvas,
      el('span', { class: 'minimap-north', text: 'N', attrs: { 'aria-hidden': 'true' } }),
    ]);
    parent.append(this.element);
  }

  /** Show the walk-in cooler on the map once its door is open, or not once it is shut again. */
  setCoolerOpen(open: boolean): void {
    if (open === this.coolerOpen) return;
    this.coolerOpen = open;
    this.view = mapView(open);
    this.drawBackground();
  }

  private drawBackground(): void {
    const bg = this.background.getContext('2d')!;
    bg.setTransform(1, 0, 0, 1, 0, 0);
    bg.clearRect(0, 0, this.background.width, this.background.height);
    bg.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    drawKitchen(bg, this.stationColors, this.view, this.coolerOpen);
  }

  /** Start a frame: the kitchen and nothing else. */
  begin(): void {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.background.width, this.background.height);
    ctx.drawImage(this.background, 0, 0);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Another player. Bound so it can be handed to an iterator without allocating per frame. */
  readonly drawPlayer = (x: number, z: number, color: string): void => {
    const ctx = this.ctx;
    const view = this.view;
    const px = view.x + x * view.scale;
    const py = view.y + z * view.scale;
    ctx.beginPath();
    ctx.arc(px, py, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 22, 40, 0.85)';
    ctx.lineWidth = 1.25;
    ctx.stroke();
  };

  /** The local player: an arrow pointing where the camera looks, with a soft view cone. */
  drawSelf(x: number, z: number, yaw: number): void {
    const ctx = this.ctx;
    ctx.save();
    const view = this.view;
    ctx.translate(view.x + x * view.scale, view.y + z * view.scale);
    // Yaw 0 looks toward -Z, which is up on the map; positive yaw turns left (counterclockwise).
    ctx.rotate(-yaw);

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 30, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
    ctx.closePath();
    ctx.fillStyle = this.cone;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(0, -7);
    ctx.lineTo(5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-5, 5);
    ctx.closePath();
    ctx.fillStyle = '#fff8f0';
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 22, 40, 0.9)';
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.restore();
  }
}
