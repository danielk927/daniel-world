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
import { paint, type Kit } from './kit.ts';

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
const WOOD = '#8a5a35';

/** The screen faces east, into the room; its glass is this far in front of the case's front. */
const FRONT = COMPUTER.x - 0.03;

/** The desk, the computer's case, its CRT housing, keyboard, mouse and tower. */
export function buildComputerDesk(kit: Kit): void {
  const d = KITCHEN.desk;
  const top = d.top;
  const cz = COMPUTER.z;
  // A butcher-block top on a steel frame, as tall as the counters: a cook works at it standing.
  kit.box('wood', d.minX, d.maxX, top - 0.045, top, d.minZ, d.maxZ, WOOD);
  for (const x of [d.minX + 0.05, d.maxX - 0.06]) {
    for (const z of [d.minZ + 0.06, d.maxZ - 0.06]) {
      kit.box('steel', x - 0.02, x + 0.02, 0, top - 0.045, z - 0.02, z + 0.02);
    }
  }
  // A shelf low down, holding the tower and a stack of order books.
  kit.box('steel', d.minX + 0.03, d.maxX - 0.04, 0.16, 0.18, d.minZ + 0.04, d.maxZ - 0.04);
  kit.box('matte', d.minX + 0.08, d.minX + 0.5, 0.18, 0.62, d.maxZ - 0.5, d.maxZ - 0.1, PLASTIC);
  kit.box(
    'matte',
    d.minX + 0.5,
    d.minX + 0.505,
    0.5,
    0.52,
    d.maxZ - 0.44,
    d.maxZ - 0.16,
    '#3a3833',
  );
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
    kit.box(
      'matte',
      d.minX + 0.1,
      d.minX + 0.42,
      y,
      y + 0.03,
      d.minZ + 0.1,
      d.minZ + 0.42,
      i % 2 ? '#7a2c25' : '#24384f',
    );
  }

  // The CRT: a deep tube housing behind a square bezel, on a swivel foot.
  const y = COMPUTER.y;
  const bezelW = SCREEN_SIZE.width + 0.1;
  const bezelH = SCREEN_SIZE.height + 0.11;
  kit.box(
    'matte',
    FRONT - 0.32,
    FRONT - 0.04,
    top,
    top + 0.025,
    cz - 0.15,
    cz + 0.15,
    PLASTIC_SHADE,
  );
  kit.box(
    'matte',
    FRONT - 0.3,
    FRONT - 0.08,
    top + 0.025,
    y - bezelH / 2,
    cz - 0.07,
    cz + 0.07,
    PLASTIC_SHADE,
  );
  kit.box(
    'matte',
    FRONT - 0.07,
    FRONT,
    y - bezelH / 2,
    y + bezelH / 2,
    cz - bezelW / 2,
    cz + bezelW / 2,
    PLASTIC,
  );
  kit.box(
    'matte',
    FRONT - 0.36,
    FRONT - 0.07,
    y - 0.15,
    y + 0.155,
    cz - 0.17,
    cz + 0.17,
    PLASTIC_SHADE,
  );
  kit.box(
    'matte',
    FRONT - 0.42,
    FRONT - 0.36,
    y - 0.11,
    y + 0.11,
    cz - 0.12,
    cz + 0.12,
    PLASTIC_SHADE,
  );
  // The glass sits in a dark recess, a little behind the bezel's face.
  kit.box(
    'iron',
    FRONT - 0.004,
    FRONT + 0.001,
    y - SCREEN_SIZE.height / 2 - 0.015,
    y + SCREEN_SIZE.height / 2 + 0.015,
    cz - SCREEN_SIZE.width / 2 - 0.015,
    cz + SCREEN_SIZE.width / 2 + 0.015,
  );
  // Power button and its lamp, under the glass on the right.
  const chin = y - SCREEN_SIZE.height / 2 - 0.035;
  kit.box(
    'matte',
    FRONT,
    FRONT + 0.006,
    chin - 0.008,
    chin + 0.008,
    cz + 0.12,
    cz + 0.145,
    PLASTIC_SHADE,
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

  // A corkboard on the wall above, with the night's order tickets pinned to it.
  const wall = d.minX;
  kit.box('matte', wall, wall + 0.02, 1.42, 2.02, d.minZ + 0.12, d.maxZ - 0.12, '#a5784c');
  kit.box('iron', wall, wall + 0.025, 2.02, 2.04, d.minZ + 0.1, d.maxZ - 0.1);
  kit.box('iron', wall, wall + 0.025, 1.4, 1.42, d.minZ + 0.1, d.maxZ - 0.1);
  const tickets: readonly (readonly [number, number, number])[] = [
    [5.05, 1.83, 0.2],
    [5.27, 1.79, 0.24],
    [5.5, 1.85, 0.18],
    [5.86, 1.62, 0.22],
    [6.07, 1.82, 0.2],
  ];
  for (const [z, ty, h] of tickets) {
    kit.box(
      'matte',
      wall + 0.02,
      wall + 0.024,
      ty - h / 2,
      ty + h / 2,
      z - 0.07,
      z + 0.07,
      paint.ticket,
    );
    kit.box(
      'light',
      wall + 0.024,
      wall + 0.03,
      ty + h / 2 - 0.02,
      ty + h / 2 - 0.008,
      z - 0.006,
      z + 0.006,
      '#c0392b',
    );
  }
  // A mug of coffee gone cold beside the keyboard.
  kit.cylinder('gloss', FRONT + 0.22, top, cz - 0.36, 0.04, 0.095, { color: paint.porcelain });
  kit.cylinder('matte', FRONT + 0.22, top + 0.088, cz - 0.36, 0.035, 0.004, { color: '#2b1a10' });

  // Keyboard and mouse, in front of the screen.
  const kx = FRONT + 0.2;
  kit.boxAt('matte', kx, top + 0.014, cz, 0.16, 0.028, 0.44, { rz: 0.06, color: PLASTIC });
  kit.boxAt('matte', kx - 0.005, top + 0.03, cz - 0.02, 0.12, 0.01, 0.36, {
    rz: 0.06,
    color: KEYCAP,
  });
  kit.boxAt('matte', kx, top + 0.014, cz + 0.32, 0.1, 0.028, 0.06, { color: PLASTIC });
  kit.box('iron', FRONT + 0.12, FRONT + 0.125, top, top + 0.003, cz - 0.3, cz + 0.35);
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
