import './styles/app.css';
import { lore } from './content.ts';
import type { Game } from './game/game.ts';
import { el } from './ui/dom.ts';
import { Landing } from './ui/landing.ts';
import { loading } from './ui/loading.ts';
import { hasWebGL2, isTouchOnly } from './util/capabilities.ts';

async function boot(): Promise<void> {
  const app = document.getElementById('app')!;
  const overlay = el('div', { class: 'ui' });
  app.append(overlay);

  let game: Game | null = null;
  const landing = new Landing(overlay, {
    onEnter: () => game?.enter(),
  });

  if (!hasWebGL2()) {
    loading.hide();
    app.classList.add('no-webgl');
    landing.setUnsupported(
      'Your browser or device cannot run the 3D world (WebGL 2 is unavailable). The portfolio has everything in it.',
    );
    landing.show();
    return;
  }
  if (isTouchOnly()) {
    landing.setNotice(
      'The world is made for a keyboard and mouse. On a phone or tablet, the portfolio page is the better way in.',
    );
  }

  loading.setText('Building the island…');
  loading.setProgress(0.15);
  // Let the loading screen paint before the heavy synchronous scene build.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  const [{ WorldScene }, { Game }] = await Promise.all([
    import('./world/scene.ts'),
    import('./game/game.ts'),
  ]);
  const canvas = el('canvas', { class: 'world-canvas' });
  app.prepend(canvas);
  const world = new WorldScene(canvas, lore);
  loading.setText('Warming up shaders…');
  loading.setProgress(0.6);
  await world.compile();
  loading.setProgress(1);

  game = new Game(world, overlay, landing);
  game.start();

  // Debug hooks exist in dev and test builds only; this inline check lets production drop the chunk.
  if (import.meta.env.MODE !== 'production') {
    const { installDebugHooks } = await import('./debug.ts');
    let frames = 0;
    let fps = 0;
    let windowStart = performance.now();
    const countFrame = (now: number): void => {
      frames++;
      if (now - windowStart >= 1000) {
        fps = (frames * 1000) / (now - windowStart);
        frames = 0;
        windowStart = now;
      }
      requestAnimationFrame(countFrame);
    };
    requestAnimationFrame(countFrame);
    installDebugHooks(game, world, () => fps);
  }

  // Two frames so the first real render is on screen before the loading screen fades.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      loading.hide();
      landing.show();
    }),
  );
}

void boot();
