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

/** The kitchen garden across the road on a bright day, seen through the north windows. */
export const gardenTexture = once(() => {
  const width = 2048;
  const height = 1024;
  const [element, ctx] = canvas(width, height);
  const random = createRandom(404);
  const sky = ctx.createLinearGradient(0, 0, 0, height * 0.6);
  sky.addColorStop(0, '#9fc7e8');
  sky.addColorStop(1, '#e4f0f6');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

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
  hills(height * 0.5, 90, '#a9b9b4', 160);
  hills(height * 0.56, 60, '#8fae86', 120);

  // Rows of vines and garden beds, then a hedge, then trees with faceted crowns.
  for (let row = 0; row < 6; row++) {
    const y = height * (0.6 + row * 0.045);
    ctx.fillStyle = row % 2 === 0 ? '#7ea364' : '#6d9455';
    ctx.fillRect(0, y, width, height * 0.03);
  }
  for (let i = 0; i < 26; i++) {
    const cx = random() * width;
    const cy = height * (0.5 + random() * 0.08);
    const r = 50 + random() * 70;
    const sides = 6 + Math.floor(random() * 3);
    ctx.fillStyle = ['#5f8f4a', '#6e9d52', '#557f43'][i % 3]!;
    ctx.beginPath();
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2 + random() * 0.3;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.85);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#6b5440';
    ctx.fillRect(cx - 6, cy + r * 0.6, 12, height * 0.06);
  }
  ctx.fillStyle = '#4f7a3f';
  ctx.fillRect(0, height * 0.86, width, height * 0.14);
  return texture(element);
});

/**
 * "Every Second Counts", the sign from the kitchen in The Bear: black block letters on white
 * paper, taped up at the corners.
 */
export const everySecondCountsTexture = once(() => {
  const [element, ctx] = canvas(1024, 256);
  ctx.fillStyle = '#f7f5ef';
  ctx.fillRect(0, 0, 1024, 256);
  ctx.fillStyle = '#141414';
  ctx.font = '900 104px "Arial Black", "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('EVERY SECOND COUNTS', 512, 134, 940);
  // Masking tape across each corner.
  ctx.fillStyle = 'rgba(226, 210, 160, 0.92)';
  for (const [x, y, angle] of [
    [0, 0, -0.6],
    [1024, 0, 0.6],
    [0, 256, 0.6],
    [1024, 256, -0.6],
  ] as const) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillRect(-70, -16, 140, 32);
    ctx.restore();
  }
  return texture(element);
});

/** The green exit sign over the back door. */
export const exitSignTexture = once(() => {
  const [element, ctx] = canvas(256, 96);
  ctx.fillStyle = '#0d3b24';
  ctx.fillRect(0, 0, 256, 96);
  ctx.fillStyle = '#7dffb0';
  ctx.font = 'bold 54px ui-rounded, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('SORTIE', 128, 52);
  return texture(element);
});
