import { CanvasTexture, SRGBColorSpace, type Texture } from 'three';

/**
 * The few textures (the signs, steam) are painted on a canvas at startup,
 * once, and shared. Nothing is downloaded. The materials' textures are painted on the GPU instead
 * (see surfaces/).
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
 * A sign lettered in the interface's Rubik, so the kitchen does not add typefaces of its own.
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
  sign(1024, 256, '500 80px Rubik, sans-serif', (ctx) => {
    ctx.fillStyle = '#1b2150';
    ctx.fillRect(0, 0, 1024, 256);
    ctx.fillStyle = '#f7f7f4';
    ctx.letterSpacing = '6px';
    ctx.fillText('EVERY SECOND COUNTS', 512, 132, 900);
  }),
);

/** The green exit sign over the back door. */
export const exitSignTexture = once(() =>
  sign(256, 96, '600 54px Rubik, sans-serif', (ctx) => {
    ctx.fillStyle = '#0d3b24';
    ctx.fillRect(0, 0, 256, 96);
    ctx.fillStyle = '#7dffb0';
    ctx.letterSpacing = '3px';
    ctx.fillText('SORTIE', 128, 52);
  }),
);
