import {
  COOLER,
  COOLER_SHELVES,
  DOORS,
  KITCHEN,
  ROOM_HALF_X,
  ROOM_HALF_Z,
  STATIONS,
  type Footprint,
  type Wall,
} from '@world/shared';
import { el } from './dom.ts';

/** CSS size of the map, a disc this wide. */
export const MAP_SIZE = 196;
/** How far from the middle of the disc the plan's farthest corner reaches, clear of the ring. */
export const PLAN_RADIUS = MAP_SIZE / 2 - 12;

/** Where the map's middle is, in pixels, and how many pixels a meter is. */
interface MapView {
  readonly scale: number;
  readonly x: number;
  readonly y: number;
}

/** A view with `extent` in the middle of the disc, as large as its corners let it be. */
function viewOf(extent: Footprint): MapView {
  const scale =
    PLAN_RADIUS / (Math.hypot(extent.maxX - extent.minX, extent.maxZ - extent.minZ) / 2);
  return {
    scale,
    x: MAP_SIZE / 2 - ((extent.minX + extent.maxX) / 2) * scale,
    y: MAP_SIZE / 2 - ((extent.minZ + extent.maxZ) / 2) * scale,
  };
}

const KITCHEN_EXTENT = {
  minX: -ROOM_HALF_X,
  maxX: ROOM_HALF_X,
  minZ: -ROOM_HALF_Z,
  maxZ: ROOM_HALF_Z,
};
/** The kitchen alone, filling the map; and with the walk-in cooler beside it, once it is open. */
const KITCHEN_VIEW = viewOf(KITCHEN_EXTENT);
const COOLER_VIEW = viewOf({ ...KITCHEN_EXTENT, maxX: COOLER.maxX });

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

/** A straight line on the plan, in world meters, from (x0, z0) to (x1, z1). */
export type PlanLine = readonly [x0: number, z0: number, x1: number, z1: number];

/** What the map draws of the kitchen, in world meters. */
export interface Plan {
  /** The walls on their inside faces, broken where the doors are. */
  readonly walls: readonly PlanLine[];
  /** The shut doors, across their openings. */
  readonly doors: readonly PlanLine[];
  /** The fixtures worth finding your way by. */
  readonly fixtures: readonly Footprint[];
  /** The stations, as points. */
  readonly stations: readonly { readonly x: number; readonly z: number }[];
}

function wallLine(wall: Wall, from: number, to: number): PlanLine {
  switch (wall) {
    case 'north':
      return [from, -ROOM_HALF_Z, to, -ROOM_HALF_Z];
    case 'south':
      return [from, ROOM_HALF_Z, to, ROOM_HALF_Z];
    case 'west':
      return [-ROOM_HALF_X, from, -ROOM_HALF_X, to];
    case 'east':
      return [ROOM_HALF_X, from, ROOM_HALF_X, to];
  }
}

const WALLS = ['north', 'east', 'south', 'west'] as const;

/** The kitchen from above, and the walk-in cooler beside it once its door has burst open. */
export function kitchenPlan(coolerOpen: boolean): Plan {
  const walls: PlanLine[] = [];
  const doors: PlanLine[] = [];
  for (const wall of WALLS) {
    const half = wall === 'north' || wall === 'south' ? ROOM_HALF_X : ROOM_HALF_Z;
    let from = -half;
    const openings = Object.values(DOORS)
      .filter((door) => door.wall === wall)
      .sort((a, b) => a.from - b.from);
    for (const door of openings) {
      walls.push(wallLine(wall, from, door.from));
      // Burst open, the walk-in's door is a way through.
      if (door !== DOORS.walkIn || !coolerOpen) doors.push(wallLine(wall, door.from, door.to));
      from = door.to;
    }
    walls.push(wallLine(wall, from, half));
  }
  const k = KITCHEN;
  // The hood hangs over the piano and the pan rack is only a rack: neither helps you find your way.
  const fixtures: Footprint[] = [
    k.windowCounter,
    k.pastryIsland,
    k.gardeManger,
    k.piano,
    k.pass,
    k.plonge,
    k.fridge,
    k.shelving,
    k.desk,
  ];
  if (coolerOpen) {
    // The cold room off the east wall, its walls on their inside faces like the kitchen's.
    walls.push(
      [ROOM_HALF_X, COOLER.minZ, COOLER.maxX, COOLER.minZ],
      [COOLER.maxX, COOLER.minZ, COOLER.maxX, COOLER.maxZ],
      [COOLER.maxX, COOLER.maxZ, ROOM_HALF_X, COOLER.maxZ],
    );
    fixtures.push(...COOLER_SHELVES);
  }
  return { walls, doors, fixtures, stations: STATIONS };
}

// The house colors (tokens.css): ivory line on the night, brass for you.
const WALL = 'rgba(242, 234, 216, 0.85)';
const LINE = 'rgba(242, 234, 216, 0.6)';
const DOOR = 'rgba(242, 234, 216, 0.3)';
const STATION = 'rgba(242, 234, 216, 0.8)';
const NIGHT = 'rgb(13, 16, 36)';
const BRASS = '#e0ad62';

/** The stations' diamonds, from the middle to a corner, in pixels. */
const DIAMOND = 2.75;
/** Players' dots, and the ring of night that lifts them off the lines they cross. */
const DOT = 2.25;
const DOT_RING = 0.75;
/** You: a notched arrowhead pointing up the map, turned to where you look. */
const ARROW = 'M0 -5.25 L4 4.5 L0 2 L-4 4.5 Z';

/** Where a line `width` device pixels wide must be centered to fill whole device pixels. */
function crisp(v: number, width: number, dpr: number): number {
  return (Math.round(v * dpr - width / 2) + width / 2) / dpr;
}

/** Plan lines, each laid on whole device pixels so they stay sharp at any pixel ratio. */
function strokeLines(
  ctx: CanvasRenderingContext2D,
  lines: readonly PlanLine[],
  view: MapView,
  dpr: number,
  width: number,
): void {
  const device = Math.max(1, Math.round(width * dpr));
  ctx.lineWidth = device / dpr;
  ctx.beginPath();
  for (const [x0, z0, x1, z1] of lines) {
    ctx.moveTo(
      crisp(view.x + x0 * view.scale, device, dpr),
      crisp(view.y + z0 * view.scale, device, dpr),
    );
    ctx.lineTo(
      crisp(view.x + x1 * view.scale, device, dpr),
      crisp(view.y + z1 * view.scale, device, dpr),
    );
  }
  ctx.stroke();
}

function strokeFootprints(
  ctx: CanvasRenderingContext2D,
  footprints: readonly Footprint[],
  view: MapView,
  dpr: number,
  width: number,
): void {
  const device = Math.max(1, Math.round(width * dpr));
  ctx.lineWidth = device / dpr;
  ctx.beginPath();
  for (const f of footprints) {
    const x0 = crisp(view.x + f.minX * view.scale, device, dpr);
    const y0 = crisp(view.y + f.minZ * view.scale, device, dpr);
    const x1 = crisp(view.x + f.maxX * view.scale, device, dpr);
    const y1 = crisp(view.y + f.maxZ * view.scale, device, dpr);
    ctx.rect(x0, y0, x1 - x0, y1 - y0);
  }
  ctx.stroke();
}

/** The kitchen in ivory line, as seen from above. Drawn only when it changes. */
function drawPlan(ctx: CanvasRenderingContext2D, plan: Plan, view: MapView, dpr: number): void {
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = LINE;
  strokeFootprints(ctx, plan.fixtures, view, dpr, 0.67);
  ctx.lineCap = 'butt';
  ctx.strokeStyle = DOOR;
  strokeLines(ctx, plan.doors, view, dpr, 0.67);
  // Square ends close the corners, and stop the walls just short into each doorway.
  ctx.lineCap = 'square';
  ctx.strokeStyle = WALL;
  strokeLines(ctx, plan.walls, view, dpr, 1);

  // Stations as diamonds, so dots always mean players. Each sits in the middle of a device pixel
  // with its corners on pixel corners, so its edges blur the same way all round.
  const half = (Math.round(DIAMOND * dpr - 0.5) + 0.5) / dpr;
  ctx.fillStyle = STATION;
  ctx.beginPath();
  for (const station of plan.stations) {
    const x = crisp(view.x + station.x * view.scale, 1, dpr);
    const y = crisp(view.y + station.z * view.scale, 1, dpr);
    ctx.moveTo(x, y - half);
    ctx.lineTo(x + half, y);
    ctx.lineTo(x, y + half);
    ctx.lineTo(x - half, y);
    ctx.closePath();
  }
  ctx.fill();
}

/**
 * Bird's-eye minimap in the corner: a night disc with the kitchen drawn on it in ivory line, other
 * players as dots of their colors, and you as a brass arrow pointing where you look. North is always
 * up. The kitchen is drawn once to an offscreen canvas; each frame only blits it and draws the
 * players.
 */
export class Minimap {
  readonly element: HTMLElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly background: HTMLCanvasElement;
  private readonly dpr: number;
  private readonly arrow = new Path2D(ARROW);
  /** The kitchen alone, or with the walk-in cooler beside it once that is open. */
  private view: MapView = KITCHEN_VIEW;
  private coolerOpen = false;

  /** The stations are all ivory now, so color always means a player; their colors go unused. */
  constructor(parent: HTMLElement, _stationColors?: readonly string[]) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = el('canvas', {
      class: 'minimap-canvas',
      attrs: { role: 'img', 'aria-label': 'Minimap: you are the arrow, other players are dots' },
    });
    canvas.width = MAP_SIZE * this.dpr;
    canvas.height = MAP_SIZE * this.dpr;
    canvas.style.width = `${MAP_SIZE}px`;
    canvas.style.height = `${MAP_SIZE}px`;
    this.ctx = canvas.getContext('2d')!;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    this.background = document.createElement('canvas');
    this.background.width = canvas.width;
    this.background.height = canvas.height;
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
    drawPlan(bg, kitchenPlan(this.coolerOpen), this.view, this.dpr);
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
    ctx.arc(px, py, DOT + DOT_RING, 0, Math.PI * 2);
    ctx.fillStyle = NIGHT;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(px, py, DOT, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  };

  /** The local player: the brass arrow, turned to where the camera looks. */
  drawSelf(x: number, z: number, yaw: number): void {
    const ctx = this.ctx;
    const view = this.view;
    const dpr = this.dpr;
    // Yaw 0 looks toward -Z, which is up on the map; positive yaw turns left (counterclockwise),
    // so the arrow turns by -yaw.
    const cos = Math.cos(yaw) * dpr;
    const sin = Math.sin(yaw) * dpr;
    ctx.setTransform(
      cos,
      -sin,
      sin,
      cos,
      (view.x + x * view.scale) * dpr,
      (view.y + z * view.scale) * dpr,
    );
    ctx.lineJoin = 'round';
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = NIGHT;
    ctx.stroke(this.arrow);
    ctx.fillStyle = BRASS;
    ctx.fill(this.arrow);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}
