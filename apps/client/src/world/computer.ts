import {
  CanvasTexture,
  Color,
  DataTexture,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  type Texture,
} from 'three';
import { COMPUTER, KITCHEN } from '@world/shared';
import { at } from './builder.ts';
import { paint, type Kit, type LayerName } from './kit.ts';

/**
 * The chef's desk in the south-west corner and the kitchen computer on it: a beige mid-nineties PC
 * with a CRT, which runs DOOM (see `../computer/`). The desk, the case and the keyboard are static
 * kitchen geometry; the screen is its own mesh, because its picture changes.
 */

/** DOOM's frame; shown 4:3, as on a CRT, so its pixels are a little taller than wide. */
export const SCREEN_PIXELS = { width: 320, height: 200 } as const;
/** The visible glass, in meters. */
export const SCREEN_SIZE = { width: 0.36, height: 0.27 } as const;

const PLASTIC = '#d6cdb6';
const PLASTIC_SHADE = '#bfb59c';
const KEYCAP = '#e4dcc8';
const WOOD = '#9a6a45';
/** Mid-nineties plastic: a dull sheen. */
const PLASTIC_FINISH = 4;

/** The screen faces east, into the room; its glass is this far in front of the case's front. */
const FRONT = COMPUTER.x - 0.03;

/** The desk, the computer's case, its CRT housing, keyboard, mouse and tower. */
export function buildComputerDesk(kit: Kit): void {
  const d = KITCHEN.desk;
  const top = d.top;
  const cz = COMPUTER.z;
  const box = (
    layer: LayerName,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    minZ: number,
    maxZ: number,
    radius: number,
    color?: string,
    finish?: number,
  ): void =>
    kit.rounded(
      layer,
      (minX + maxX) / 2,
      (minY + maxY) / 2,
      (minZ + maxZ) / 2,
      maxX - minX,
      maxY - minY,
      maxZ - minZ,
      radius,
      color,
      { finish },
    );
  // A butcher-block top on a steel frame of round legs, as tall as the counters: a cook works at it
  // standing.
  box('wood', d.minX, d.maxX, top - 0.045, top, d.minZ, d.maxZ, 0.006, WOOD);
  for (const x of [d.minX + 0.05, d.maxX - 0.06]) {
    for (const z of [d.minZ + 0.06, d.maxZ - 0.06]) {
      kit.cylinder('steel', x, 0, z, 0.019, top - 0.045);
    }
  }
  // A shelf low down, holding the tower and a stack of order books.
  box('steel', d.minX + 0.03, d.maxX - 0.04, 0.16, 0.18, d.minZ + 0.04, d.maxZ - 0.04, 0.004);
  box(
    'gloss',
    d.minX + 0.08,
    d.minX + 0.5,
    0.18,
    0.62,
    d.maxZ - 0.5,
    d.maxZ - 0.1,
    0.008,
    PLASTIC,
    PLASTIC_FINISH,
  );
  // Its face: a floppy drive's slot, a vented panel and the power lamp.
  box(
    'gloss',
    d.minX + 0.497,
    d.minX + 0.505,
    0.5,
    0.52,
    d.maxZ - 0.44,
    d.maxZ - 0.16,
    0.002,
    '#3a3833',
    2,
  );
  for (let i = 0; i < 6; i++) {
    const y = 0.28 + i * 0.022;
    box(
      'gloss',
      d.minX + 0.497,
      d.minX + 0.503,
      y,
      y + 0.008,
      d.maxZ - 0.42,
      d.maxZ - 0.18,
      0.002,
      PLASTIC_SHADE,
      PLASTIC_FINISH,
    );
  }
  kit.box(
    'light',
    d.minX + 0.5,
    d.minX + 0.506,
    0.25,
    0.262,
    d.maxZ - 0.18,
    d.maxZ - 0.168,
    '#4dff7a',
  );
  for (let i = 0; i < 3; i++) {
    const y = 0.18 + i * 0.035;
    box(
      'matte',
      d.minX + 0.1,
      d.minX + 0.42,
      y,
      y + 0.03,
      d.minZ + 0.1,
      d.minZ + 0.42,
      0.004,
      i % 2 ? '#7a2c25' : '#24384f',
    );
  }

  // The CRT: a deep tube housing behind a square bezel, on a swivel foot.
  const y = COMPUTER.y;
  const bezelW = SCREEN_SIZE.width + 0.1;
  const bezelH = SCREEN_SIZE.height + 0.11;
  box(
    'gloss',
    FRONT - 0.32,
    FRONT - 0.04,
    top,
    top + 0.025,
    cz - 0.15,
    cz + 0.15,
    0.01,
    PLASTIC_SHADE,
    PLASTIC_FINISH,
  );
  box(
    'gloss',
    FRONT - 0.3,
    FRONT - 0.08,
    top + 0.025,
    y - bezelH / 2,
    cz - 0.07,
    cz + 0.07,
    0.01,
    PLASTIC_SHADE,
    PLASTIC_FINISH,
  );
  box(
    'gloss',
    FRONT - 0.07,
    FRONT,
    y - bezelH / 2,
    y + bezelH / 2,
    cz - bezelW / 2,
    cz + bezelW / 2,
    0.018,
    PLASTIC,
    PLASTIC_FINISH,
  );
  box(
    'gloss',
    FRONT - 0.36,
    FRONT - 0.07,
    y - 0.15,
    y + 0.155,
    cz - 0.17,
    cz + 0.17,
    0.03,
    PLASTIC_SHADE,
    PLASTIC_FINISH,
  );
  box(
    'gloss',
    FRONT - 0.42,
    FRONT - 0.36,
    y - 0.11,
    y + 0.11,
    cz - 0.12,
    cz + 0.12,
    0.02,
    PLASTIC_SHADE,
    PLASTIC_FINISH,
  );
  // The glass sits in a dark recess, a little behind the bezel's face, under a film of reflection.
  box(
    'gloss',
    FRONT - 0.004,
    FRONT + 0.001,
    y - SCREEN_SIZE.height / 2 - 0.015,
    y + SCREEN_SIZE.height / 2 + 0.015,
    cz - SCREEN_SIZE.width / 2 - 0.015,
    cz + SCREEN_SIZE.width / 2 + 0.015,
    0.004,
    '#141413',
    2,
  );
  kit.add(
    'pane',
    new PlaneGeometry(SCREEN_SIZE.width, SCREEN_SIZE.height),
    at(COMPUTER.x - 0.023, y, cz, { ry: Math.PI / 2 }),
  );
  // Power button and its lamp, under the glass on the right.
  const chin = y - SCREEN_SIZE.height / 2 - 0.035;
  box(
    'gloss',
    FRONT,
    FRONT + 0.006,
    chin - 0.008,
    chin + 0.008,
    cz + 0.12,
    cz + 0.145,
    0.003,
    PLASTIC_SHADE,
    PLASTIC_FINISH,
  );
  kit.box(
    'light',
    FRONT,
    FRONT + 0.004,
    chin - 0.003,
    chin + 0.003,
    cz + 0.1,
    cz + 0.108,
    '#57ff6e',
  );

  // A corkboard on the wall above in a thin wooden frame, the night's order tickets pinned to it.
  const wall = d.minX;
  box('matte', wall, wall + 0.02, 1.42, 2.02, d.minZ + 0.12, d.maxZ - 0.12, 0.003, '#a87c50');
  for (const [y0, y1] of [
    [2.02, 2.04],
    [1.4, 1.42],
  ] as const) {
    box('wood', wall, wall + 0.025, y0, y1, d.minZ + 0.1, d.maxZ - 0.1, 0.004, WOOD);
  }
  for (const z of [d.minZ + 0.1, d.maxZ - 0.12]) {
    box('wood', wall, wall + 0.025, 1.42, 2.02, z, z + 0.02, 0.004, WOOD);
  }
  const tickets: readonly (readonly [number, number, number])[] = [
    [5.05, 1.83, 0.2],
    [5.27, 1.79, 0.24],
    [5.5, 1.85, 0.18],
    [5.86, 1.62, 0.22],
    [6.07, 1.82, 0.2],
  ];
  tickets.forEach(([z, ty, h], i) => {
    kit.boxAt('matte', wall + 0.022, ty, z, 0.004, h, 0.14, {
      rx: (i % 2 ? 1 : -1) * 0.03,
      color: paint.ticket,
    });
    kit.sphere('gloss', wall + 0.03, ty + h / 2 - 0.014, z, 0.006, {
      color: '#b8302a',
      finish: 0.8,
    });
  });
  // A mug of coffee gone cold beside the keyboard.
  const mx = FRONT + 0.22;
  const mz = cz - 0.36;
  kit.lathe(
    'gloss',
    mx,
    top,
    mz,
    [
      [0.001, 0],
      [0.036, 0],
      [0.04, 0.004],
      [0.04, 0.092],
      [0.0385, 0.095],
      [0.036, 0.093],
      [0.036, 0.012],
      [0.001, 0.012],
    ],
    { color: paint.porcelain, finish: 0.6 },
  );
  kit.cylinder('food', mx, top + 0.084, mz, 0.0355, 0.001, { color: '#2b1a10', finish: 0.15 });
  kit.add(
    'gloss',
    kit.torus(0.026, 0.006, Math.PI),
    at(mx, top + 0.05, mz - 0.04, { ry: Math.PI / 2, rz: -Math.PI / 2 }),
    paint.porcelain,
    { uv: 'own', finish: 0.6 },
  );

  // Keyboard and mouse, in front of the screen: a sloped case of keycaps in rows.
  const kx = FRONT + 0.2;
  const tilt = 0.06;
  kit.rounded('gloss', kx, top + 0.014, cz, 0.16, 0.028, 0.44, 0.008, PLASTIC, {
    rz: tilt,
    finish: PLASTIC_FINISH,
  });
  for (let row = 0; row < 5; row++) {
    const u = -0.055 + row * 0.024;
    const keys = row === 4 ? 1 : 15;
    for (let k = 0; k < keys; k++) {
      const v = row === 4 ? 0 : -0.175 + k * 0.025 + (row % 2) * 0.006;
      const w = row === 4 ? 0.15 : 0.019;
      // Along the slope of the case: down toward the front edge, nearest the cook.
      const x = kx + u * Math.cos(tilt) - 0.0185 * Math.sin(tilt);
      const yk = top + 0.014 + u * Math.sin(tilt) + 0.0185 * Math.cos(tilt);
      kit.rounded('gloss', x, yk, cz + v, 0.019, 0.009, w, 0.003, KEYCAP, {
        rz: tilt,
        finish: PLASTIC_FINISH,
      });
    }
  }
  kit.rounded('gloss', kx, top + 0.014, cz + 0.32, 0.1, 0.026, 0.06, 0.012, PLASTIC, {
    finish: PLASTIC_FINISH,
  });
  kit.box('iron', FRONT + 0.12, FRONT + 0.125, top, top + 0.003, cz - 0.3, cz + 0.35, '#2a2826');
}

/**
 * The CRT's picture: a DOS prompt while the computer waits, DOOM's frames once it runs. Shown with
 * a faint scanline pattern and nearest-neighbour sampling, so the pixels stay crisp up close.
 */
export class ComputerScreen {
  readonly mesh: Mesh;
  private readonly material: MeshBasicMaterial;
  private readonly frame: DataTexture;
  private readonly standby: CanvasTexture;
  private readonly ctx: CanvasRenderingContext2D;
  private blink = 0;
  private cursorOn = true;
  private running = false;

  constructor(hdr: boolean) {
    const canvas = document.createElement('canvas');
    canvas.width = SCREEN_PIXELS.width;
    canvas.height = SCREEN_PIXELS.height;
    this.ctx = canvas.getContext('2d')!;
    this.standby = configure(new CanvasTexture(canvas));
    this.frame = configure(
      new DataTexture(
        new Uint8Array(SCREEN_PIXELS.width * SCREEN_PIXELS.height * 4),
        SCREEN_PIXELS.width,
        SCREEN_PIXELS.height,
        RGBAFormat,
      ),
    );
    this.drawStandby();

    // Row 0 of both pictures is the top line, so the plane's v runs downwards.
    const geometry = new PlaneGeometry(SCREEN_SIZE.width, SCREEN_SIZE.height);
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    this.material = new MeshBasicMaterial({
      map: this.standby,
      // A lit screen, kept dim so the bloom only just catches it.
      color: new Color(1, 1, 1).multiplyScalar(hdr ? 1.15 : 1),
    });
    this.material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        // Scanlines, one per row of DOOM's 200, and the tube's darker corners.
        float line = 0.82 + 0.18 * sin(vMapUv.y * ${SCREEN_PIXELS.height.toFixed(1)} * 6.2831853);
        vec2 edge = vMapUv * (1.0 - vMapUv) * 16.0;
        diffuseColor.rgb *= line * clamp(pow(edge.x * edge.y, 0.18), 0.0, 1.0);`,
      );
    };
    this.mesh = new Mesh(geometry, this.material);
    this.mesh.position.set(COMPUTER.x - 0.025, COMPUTER.y, COMPUTER.z);
    this.mesh.rotation.y = Math.PI / 2;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.updateMatrix();
  }

  /** Show a new frame from the computer: 320 by 200 RGBA, top row first. */
  showFrame(pixels: Uint8ClampedArray): void {
    const image = this.frame.image as { data: Uint8Array | Uint8ClampedArray };
    image.data = pixels;
    this.frame.needsUpdate = true;
    if (!this.running) {
      this.running = true;
      this.material.map = this.frame;
    }
  }

  /** Back to the DOS prompt, e.g. when the computer fails to start. */
  showStandby(): void {
    this.running = false;
    this.material.map = this.standby;
  }

  /** Call every frame; the waiting prompt's cursor blinks. */
  update(dt: number): void {
    if (this.running) return;
    this.blink += dt;
    if (this.blink < 0.5) return;
    this.blink = 0;
    this.cursorOn = !this.cursorOn;
    this.drawCursor();
  }

  private drawStandby(): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#050605';
    ctx.fillRect(0, 0, SCREEN_PIXELS.width, SCREEN_PIXELS.height);
    ctx.font = '10px "Courier New", monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#b8bcb2';
    const lines = [
      'KITCHEN-PC BIOS v1.0   RV32IM @ 100 MHz',
      'Memory test: 16384K OK',
      '',
      'C:\\> dir /w',
      'DOOM.EXE    DOOM1.WAD    MENU.TXT',
      '',
      'C:\\> doom',
    ];
    lines.forEach((line, i) => ctx.fillText(line, 8, 10 + i * 13));
    this.drawCursor();
  }

  private drawCursor(): void {
    const ctx = this.ctx;
    const x = 8 + ctx.measureText('C:\\> doom').width + 2;
    const y = 10 + 6 * 13;
    ctx.fillStyle = this.cursorOn ? '#b8bcb2' : '#050605';
    ctx.fillRect(x, y + 8, 6, 2);
    this.standby.needsUpdate = true;
  }
}

function configure<T extends Texture>(texture: T): T {
  texture.colorSpace = SRGBColorSpace;
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  return texture;
}

/** Where the camera sits to use the computer: square in front of the glass, the screen filling most of the view. */
export function computerViewpoint(
  fovDegrees: number,
  out: { x: number; y: number; z: number },
): void {
  const fill = 0.78;
  const distance = SCREEN_SIZE.height / 2 / Math.tan(((fovDegrees * fill) / 2) * (Math.PI / 180));
  out.x = COMPUTER.x - 0.025 + distance + 0.08;
  out.y = COMPUTER.y;
  out.z = COMPUTER.z;
}
