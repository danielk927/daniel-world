import { DOORS, KITCHEN, ROOM_HALF_X, ROOM_HALF_Z, STATIONS } from '@world/shared';
import { el } from './dom.ts';

/** CSS size of the map, in pixels. The kitchen fills it with a margin. */
const MARGIN = 8;
export const MAP_WIDTH = 176;
/** World units to map pixels. */
const SCALE = (MAP_WIDTH - MARGIN * 2) / (ROOM_HALF_X * 2);
export const MAP_HEIGHT = Math.round(ROOM_HALF_Z * 2 * SCALE + MARGIN * 2);
const CENTER_X = MAP_WIDTH / 2;
const CENTER_Y = MAP_HEIGHT / 2;

/** World (x, z) to map pixels. North (-Z) is up. */
export function worldToMap(x: number, z: number): { x: number; y: number } {
  return { x: CENTER_X + x * SCALE, y: CENTER_Y + z * SCALE };
}

function rect(
  ctx: CanvasRenderingContext2D,
  f: { minX: number; maxX: number; minZ: number; maxZ: number },
): void {
  const a = worldToMap(f.minX, f.minZ);
  ctx.fillRect(a.x, a.y, (f.maxX - f.minX) * SCALE, (f.maxZ - f.minZ) * SCALE);
}

/** The kitchen as seen from above. Drawn once; it never changes. */
function drawKitchen(ctx: CanvasRenderingContext2D, stationColors: readonly string[]): void {
  // Floor and walls.
  ctx.fillStyle = '#9da2a5';
  rect(ctx, { minX: -ROOM_HALF_X, maxX: ROOM_HALF_X, minZ: -ROOM_HALF_Z, maxZ: ROOM_HALF_Z });
  ctx.strokeStyle = 'rgba(244, 238, 228, 0.9)';
  ctx.lineWidth = 2;
  const corner = worldToMap(-ROOM_HALF_X, -ROOM_HALF_Z);
  ctx.strokeRect(corner.x, corner.y, ROOM_HALF_X * 2 * SCALE, ROOM_HALF_Z * 2 * SCALE);

  // Doors as warm gaps in the walls.
  ctx.fillStyle = '#ffc98c';
  for (const door of Object.values(DOORS)) {
    const span = (door.to - door.from) * SCALE;
    if (door.wall === 'north' || door.wall === 'south') {
      const a = worldToMap(door.from, door.wall === 'north' ? -ROOM_HALF_Z : ROOM_HALF_Z);
      ctx.fillRect(a.x, a.y - 1.5, span, 3);
    } else {
      const a = worldToMap(door.wall === 'west' ? -ROOM_HALF_X : ROOM_HALF_X, door.from);
      ctx.fillRect(a.x - 1.5, a.y, 3, span);
    }
  }

  // Counters and islands in steel, the cooking suite darker under its hood.
  const { piano, hood, ...counters } = KITCHEN;
  ctx.fillStyle = '#a9adb2';
  for (const f of Object.values(counters)) rect(ctx, f);
  ctx.fillStyle = 'rgba(201, 206, 211, 0.35)';
  rect(ctx, hood);
  ctx.fillStyle = '#5b636b';
  rect(ctx, piano);
  ctx.strokeStyle = '#d3dbe1';
  ctx.lineWidth = 1;
  const p = worldToMap(piano.minX, piano.minZ);
  ctx.strokeRect(p.x, p.y, (piano.maxX - piano.minX) * SCALE, (piano.maxZ - piano.minZ) * SCALE);

  // Stations as diamonds in their colors, so circles always mean players.
  STATIONS.forEach((station, i) => {
    const s = worldToMap(station.x, station.z);
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
  /** Player whose dot gets the tag ring, if a round of tag is running. */
  markedId: number | null = null;

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
    const bg = this.background.getContext('2d')!;
    bg.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    drawKitchen(bg, stationColors);

    this.element = el('div', { class: 'minimap' }, [
      canvas,
      el('span', { class: 'minimap-north', text: 'N', attrs: { 'aria-hidden': 'true' } }),
    ]);
    parent.append(this.element);
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
  readonly drawPlayer = (id: number, x: number, z: number, color: string): void => {
    const ctx = this.ctx;
    const px = CENTER_X + x * SCALE;
    const py = CENTER_Y + z * SCALE;
    if (id === this.markedId) {
      ctx.beginPath();
      ctx.arc(px, py, 6.5, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff5a5a';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(px, py, 3.6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(30, 22, 40, 0.85)';
    ctx.lineWidth = 1.25;
    ctx.stroke();
  };

  /** The local player: an arrow pointing where the camera looks, with a soft view cone. */
  drawSelf(x: number, z: number, yaw: number, marked: boolean): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(CENTER_X + x * SCALE, CENTER_Y + z * SCALE);
    // Yaw 0 looks toward -Z, which is up on the map; positive yaw turns left (counterclockwise).
    ctx.rotate(-yaw);

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 30, -Math.PI / 2 - 0.55, -Math.PI / 2 + 0.55);
    ctx.closePath();
    ctx.fillStyle = this.cone;
    ctx.fill();

    if (marked) {
      ctx.beginPath();
      ctx.arc(0, 0, 8, 0, Math.PI * 2);
      ctx.strokeStyle = '#ff5a5a';
      ctx.lineWidth = 2;
      ctx.stroke();
    }
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
