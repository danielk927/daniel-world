import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';
import { createRandom } from '@world/shared';

/**
 * The few textures (the view outside, the signs, steam) are painted on a canvas at startup,
 * once, and shared. Nothing is downloaded. Everything else is plain color on faceted geometry.
 */

function canvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const element = document.createElement('canvas');
  element.width = width;
  element.height = height;
  return [element, element.getContext('2d')!];
}

function texture(element: HTMLCanvasElement): Texture {
  const t = new CanvasTexture(element);
  t.colorSpace = SRGBColorSpace;
  return t;
}

function once<T>(make: () => T): () => T {
  let value: T | null = null;
  return () => (value ??= make());
}

/** A wide gaussian puff with no bright core, for steam. */
export const softTexture = once(() => {
  const size = 128;
  const [element, ctx] = canvas(size, size);
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const v = Math.exp(-(dx * dx + dy * dy) * 18) * Math.max(0, 1 - Math.hypot(dx, dy) * 2);
      const i = (y * size + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = Math.round(v * 255);
      image.data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return texture(element);
});

/**
 * The kitchen garden across the road at the blue hour, seen through the north windows: a deep blue
 * sky with the last peach glow on the horizon, the hills and trees gone to silhouette, and a strand
 * of warm string lights along the hedge.
 */
export const gardenTexture = once(() => {
  const width = 2048;
  const height = 1024;
  const [element, ctx] = canvas(width, height);
  const random = createRandom(404);
  const sky = ctx.createLinearGradient(0, 0, 0, height * 0.58);
  sky.addColorStop(0, '#16233f');
  sky.addColorStop(0.55, '#3b4d78');
  sky.addColorStop(0.85, '#8a7f9c');
  sky.addColorStop(1, '#e3a98a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);
  // A few early stars, high up where the sky is darkest.
  for (let i = 0; i < 70; i++) {
    ctx.fillStyle = `rgba(235, 240, 255, ${0.25 + random() * 0.5})`;
    const r = random() < 0.15 ? 2 : 1.2;
    ctx.fillRect(random() * width, random() * height * 0.32, r, r);
  }

  // Rolling hills of the valley, in two flat bands, each a run of straight facets.
  const hills = (base: number, amplitude: number, color: string, step: number): void => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, height);
    for (let x = 0; x <= width + step; x += step) {
      ctx.lineTo(x, base - (random() * 0.6 + 0.4) * amplitude);
    }
    ctx.lineTo(width, height);
    ctx.closePath();
    ctx.fill();
  };
  hills(height * 0.5, 90, '#3c4763', 160);
  hills(height * 0.56, 60, '#2c3a45', 120);

  // Rows of vines and garden beds, then trees with faceted crowns, all in the dusk.
  for (let row = 0; row < 6; row++) {
    const y = height * (0.6 + row * 0.045);
    ctx.fillStyle = row % 2 === 0 ? '#25362f' : '#203029';
    ctx.fillRect(0, y, width, height * 0.03);
  }
  for (let i = 0; i < 26; i++) {
    const cx = random() * width;
    const cy = height * (0.5 + random() * 0.08);
    const r = 50 + random() * 70;
    const sides = 6 + Math.floor(random() * 3);
    ctx.fillStyle = ['#1e2d2a', '#233430', '#1a2724'][i % 3]!;
    ctx.beginPath();
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2 + random() * 0.3;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.85);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#1c1714';
    ctx.fillRect(cx - 6, cy + r * 0.6, 12, height * 0.06);
  }
  ctx.fillStyle = '#16211c';
  ctx.fillRect(0, height * 0.86, width, height * 0.14);

  // String lights, swagged between posts along the hedge, each bulb with a soft halo.
  const posts = 9;
  const top = height * 0.8;
  for (let p = 0; p < posts; p++) {
    const x0 = (p / posts) * width;
    const x1 = ((p + 1) / posts) * width;
    for (let k = 0; k <= 10; k++) {
      const t = k / 10;
      const x = x0 + (x1 - x0) * t;
      const y = top + Math.sin(t * Math.PI) * 26;
      const halo = ctx.createRadialGradient(x, y, 0, x, y, 14);
      halo.addColorStop(0, 'rgba(255, 214, 150, 0.95)');
      halo.addColorStop(0.3, 'rgba(255, 190, 120, 0.45)');
      halo.addColorStop(1, 'rgba(255, 170, 100, 0)');
      ctx.fillStyle = halo;
      ctx.fillRect(x - 14, y - 14, 28, 28);
    }
  }
  return texture(element);
});

/**
 * A sign lettered in the interface's Jost, so the kitchen does not add typefaces of its own.
 * Canvas text only uses a web font once it has loaded, so the sign is repainted when it arrives.
 */
function sign(
  width: number,
  height: number,
  font: string,
  paint: (ctx: CanvasRenderingContext2D) => void,
): Texture {
  const [element, ctx] = canvas(width, height);
  const t = texture(element);
  const draw = () => {
    ctx.font = font;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    paint(ctx);
    t.needsUpdate = true;
  };
  draw();
  void document.fonts.load(font).then(draw);
  return t;
}

/**
 * "Every Second Counts", the nameplate from The Bear: white capitals on a navy plate. The black
 * rails that hold it are geometry, not paint.
 */
export const everySecondCountsTexture = once(() =>
  sign(1024, 256, '500 80px Jost, sans-serif', (ctx) => {
    ctx.fillStyle = '#1b2150';
    ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = '#f7f7f4';
    ctx.letterSpacing = '6px';
    ctx.fillText('EVERY SECOND COUNTS', 512, 132, 900);
  }),
);

/** The green exit sign over the back door. */
export const exitSignTexture = once(() =>
  sign(256, 96, '600 54px Jost, sans-serif', (ctx) => {
    ctx.fillStyle = '#0d3b24';
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = '#7dffb0';
    ctx.letterSpacing = '3px';
    ctx.fillText('SORTIE', 128, 52);
  }),
);
