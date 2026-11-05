import './styles/app.css';
import { DEFAULT_ROOM } from '@world/shared';
import { dishes, stations } from './content.ts';
import type { Game } from './game/game.ts';
import { Settings } from './game/settings.ts';
import { el } from './ui/dom.ts';
import { Intro } from './ui/intro.ts';
import { Landing } from './ui/landing.ts';
import { loading } from './ui/loading.ts';
import { SERVER_HTTP_URL } from './env.ts';
import { isTouchOnly, pickQuality, probeWebGL, type WebGLProbe } from './util/capabilities.ts';
import { snapRefreshInterval } from './world/governor.ts';

/** The display's refresh interval: the shortest of a few frame intervals, snapped to a standard rate. */
function measureRefreshInterval(frames = 20): Promise<number> {
  return new Promise((resolve) => {
    let last = -1;
    let shortest = Infinity;
    let count = 0;
    const tick = (now: number): void => {
      if (last >= 0) shortest = Math.min(shortest, now - last);
      last = now;
      if (++count <= frames) requestAnimationFrame(tick);
      else resolve(snapRefreshInterval(shortest));
    };
    requestAnimationFrame(tick);
  });
}

/**
 * Build the kitchen and the game in it, behind the intro: download the code, build the scene,
 * compile its shaders and draw it once, so the game shows at once when the visitor asks for it.
 * The game is not started; nothing draws until then.
 */
async function buildKitchen(
  app: HTMLElement,
  overlay: HTMLElement,
  landing: Landing,
  webgl: WebGLProbe,
): Promise<Game> {
  let canvas: HTMLCanvasElement | null = null;
  try {
    loading.setText('Building the kitchen…');
    loading.setProgress(0.15);
    // Let the page paint before the heavy synchronous scene build.
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    // How often the display refreshes, measured while nothing heavy draws yet, for the governor.
    const refresh = measureRefreshInterval();
    const [{ WorldScene }, { Game }] = await Promise.all([
      import('./world/scene.ts'),
      import('./game/game.ts'),
    ]);
    canvas = el('canvas', { class: 'world-canvas' });
    app.prepend(canvas);
    const settings = Settings.load();
    const quality = pickQuality(webgl, settings.values.quality);
    const world = new WorldScene(canvas, stations, dishes, quality);
    loading.setText('Compiling shaders…');
    loading.setProgress(0.6);
    await world.compile();
    // `?governor=off` holds the best level whatever the frame rate, so a check with the frame rate
    // uncapped (`scripts/perf.ts --uncapped`) measures how fast it draws. Dev and test builds only.
    const ungoverned =
      import.meta.env.MODE !== 'production' &&
      new URLSearchParams(location.search).get('governor') === 'off';
    if (!ungoverned) world.startGovernor(await refresh);

    const game = new Game(world, overlay, landing, settings, pickQuality(webgl));
    // The E2E suite's build only: pages it is not driving draw a few times a second (see the
    // module). An inline check, like the debug hooks', so other builds drop the chunk.
    if (import.meta.env.MODE === 'test') {
      const { drawOnlyWhileDriven } = await import('./testDrawing.ts');
      drawOnlyWhileDriven(world);
    }
    // Debug hooks exist in dev and test builds only; this inline check lets production drop the chunk.
    if (import.meta.env.MODE !== 'production') {
      const { installDebugHooks } = await import('./debug.ts');
      installDebugHooks(game, world);
    }
    // One frame behind the intro, so post-processing's shaders compile now and not on the first
    // frame the visitor sees.
    world.render();
    loading.setProgress(1);
    void world.compileWalkInLight();
    return game;
  } catch (error) {
    canvas?.remove();
    throw error;
  }
}

/** Run `task` once the browser is idle, so the intro is on screen and answering first. */
function whenIdle(task: () => void): void {
  if ('requestIdleCallback' in window) requestIdleCallback(task, { timeout: 1000 });
  else setTimeout(task, 100);
}

function boot(): void {
  const app = document.getElementById('app')!;
  const overlay = el('div', { class: 'ui' });
  app.append(overlay);

  let game: Game | null = null;
  const landing = new Landing(overlay, {
    onEnter: (name, room) => game?.enter(name, room),
  });
  const intro = new Intro(document.getElementById('intro')!, () => void play());
  const webgl = probeWebGL();

  /** The kitchen, built once, by whichever asks first: the idle preload or Play. */
  let kitchen: Promise<Game | null> | null = null;
  const loadKitchen = (): Promise<Game | null> =>
    (kitchen ??= buildKitchen(app, overlay, landing, webgl).then(
      (built) => (game = built),
      (error: unknown) => {
        // Code that would not load (a deploy landed while the page loaded), or a renderer that
        // would not start after the probe said it could: the intro says so and offers the resume.
        console.error('The kitchen did not load.', error);
        loading.hide();
        intro.show();
        intro.unavailable(
          'The kitchen did not load. Reload the page to try again, or read the resume instead.',
        );
        return null;
      },
    ));

  let playing = false;
  async function play(): Promise<void> {
    if (playing) return;
    playing = true;
    // Over the intro, until the kitchen is ready.
    if (!game) loading.show();
    const built = await loadKitchen();
    if (!built) return;
    built.start();
    // Two frames so the first real render is on screen before the intro (or the loading screen) fades.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        loading.hide();
        intro.hide();
        landing.show();
        pollLobbyCount(landing);
      }),
    );
  }

  if (!webgl.supported) {
    intro.unavailable(
      'Your browser or device cannot run the 3D world (WebGL 2 is unavailable). You can read the resume instead.',
    );
    return;
  }
  if (isTouchOnly()) {
    // The kitchen is built only if asked for: a phone need not build one it is told to skip.
    const message =
      'The world is made for a keyboard and mouse. On a phone or tablet, the resume is the better way in.';
    intro.suggestResume(message);
    landing.suggestResume(message);
    return;
  }
  intro.keepForResume();
  whenIdle(() => void loadKitchen());
}

/** Keep the landing page's lobby count fresh while it is visible. */
function pollLobbyCount(landing: Landing): void {
  const refresh = async (): Promise<void> => {
    if (document.hidden || landing.element.hidden) return;
    try {
      const response = await fetch(`${SERVER_HTTP_URL}/rooms/${DEFAULT_ROOM}`, {
        signal: AbortSignal.timeout(3000),
      });
      const body = (await response.json()) as { players?: unknown };
      landing.setCount(typeof body.players === 'number' ? body.players : null);
    } catch {
      landing.setCount(null);
    }
  };
  void refresh();
  window.setInterval(() => void refresh(), 4000);
}

boot();
