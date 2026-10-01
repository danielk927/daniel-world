import {
  FOUNTAIN,
  ISLAND_RADIUS,
  LORE_SLOTS,
  PLAZA_RADIUS,
  ROCKS,
  RUIN_BLOCKS,
  TREES,
  type TreeKind,
} from '@world/shared';
import { el } from './dom.ts';

/** CSS size of the map, in pixels. */
const SIZE = 176;
const CENTER = SIZE / 2;
/** World units to map pixels; the island fills the circle with a little margin. */
const SCALE = (CENTER - 8) / ISLAND_RADIUS;

const TREE_COLORS: Record<TreeKind, string> = {
  round: '#4f8a3a',
  pine: '#2f6b45',
  blossom: '#e996b8',
};

/** World (x, z) to map pixels. North (-Z) is up. */
export function worldToMap(x: number, z: number): { x: number; y: number } {
  return { x: CENTER + x * SCALE, y: CENTER + z * SCALE };
}

function circle(ctx: CanvasRenderingContext2D, x: number, z: number, radius: number): void {
  ctx.beginPath();
  ctx.arc(CENTER + x * SCALE, CENTER + z * SCALE, radius, 0, Math.PI * 2);
}

/** The island as seen from above. Drawn once; it never changes. */
function drawIsland(ctx: CanvasRenderingContext2D, loreColors: readonly string[]): void {
  // Grass, lighter toward the plaza.
  const grass = ctx.createRadialGradient(CENTER, CENTER, 0, CENTER, CENTER, ISLAND_RADIUS * SCALE);
  grass.addColorStop(0, '#9cc964');
  grass.addColorStop(1, '#6f9f48');
  circle(ctx, 0, 0, ISLAND_RADIUS * SCALE);
  ctx.fillStyle = grass;
  ctx.fill();

  // Rim wall.
  circle(ctx, 0, 0, (ISLAND_RADIUS - 0.95) * SCALE);
  ctx.strokeStyle = 'rgba(232, 220, 198, 0.9)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Plaza with its tile rings.
  circle(ctx, 0, 0, PLAZA_RADIUS * SCALE);
  ctx.fillStyle = '#dccaa8';
  ctx.fill();
  ctx.strokeStyle = 'rgba(140, 120, 90, 0.35)';
  ctx.lineWidth = 0.75;
  for (let r = FOUNTAIN.basinRadius + 1.2; r < PLAZA_RADIUS; r += 1.6) {
    circle(ctx, 0, 0, r * SCALE);
    ctx.stroke();
  }

  // Ruins: the east arch and the west stair with its lookout.
  ctx.fillStyle = '#c9b79b';
  for (const b of RUIN_BLOCKS) {
    const a = worldToMap(b.minX, b.minZ);
    ctx.fillRect(a.x, a.y, (b.maxX - b.minX) * SCALE, (b.maxZ - b.minZ) * SCALE);
  }

  ctx.fillStyle = '#9a8f97';
  for (const rock of ROCKS) {
    circle(ctx, rock.x, rock.z, Math.max(1, rock.scale * 0.9 * SCALE));
    ctx.fill();
  }

  for (const tree of TREES) {
    circle(ctx, tree.x, tree.z, 1.25 * tree.scale * SCALE);
    ctx.fillStyle = TREE_COLORS[tree.kind];
    ctx.fill();
  }

  // Fountain: stone ring, water, and the crystal.
  circle(ctx, 0, 0, FOUNTAIN.basinRadius * SCALE);
  ctx.fillStyle = '#7fcfd8';
  ctx.fill();
  ctx.strokeStyle = '#efe3cb';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  circle(ctx, 0, 0, 1.6);
  ctx.fillStyle = '#ffd27a';
  ctx.fill();

  // Lore pedestals as diamonds in their object colors, so circles always mean players.
  LORE_SLOTS.forEach((slot, i) => {
    const p = worldToMap(slot.x, slot.z);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y - 4);
    ctx.lineTo(p.x + 4, p.y);
    ctx.lineTo(p.x, p.y + 4);
    ctx.lineTo(p.x - 4, p.y);
    ctx.closePath();
    ctx.fillStyle = loreColors[i] ?? '#ffffff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();
  });
}

/**
 * Bird's-eye minimap in the corner: the island, other players as colored dots, and the local player
 * as an arrow with a view cone. North is always up. The island is rendered once to an offscreen
 * canvas; each frame only blits it and draws the players.
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

  constructor(parent: HTMLElement, loreColors: readonly string[]) {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = el('canvas', {
      class: 'minimap-canvas',
      attrs: { role: 'img', 'aria-label': 'Minimap: you are the arrow, other players are dots' },
    });
    canvas.width = SIZE * this.dpr;
    canvas.height = SIZE * this.dpr;
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
    drawIsland(bg, loreColors);

    this.element = el('div', { class: 'minimap' }, [
      canvas,
      el('span', { class: 'minimap-north', text: 'N', attrs: { 'aria-hidden': 'true' } }),
    ]);
    parent.append(this.element);
  }

  /** Start a frame: the island and nothing else. */
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
    const px = CENTER + x * SCALE;
    const py = CENTER + z * SCALE;
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
    ctx.translate(CENTER + x * SCALE, CENTER + z * SCALE);
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
