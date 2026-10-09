import type { WorldScene } from './world/scene.ts';

/** A page with no input for this long, and no key or button down, is not being driven. */
const DRIVEN_MS = 1000;
/** A page nobody is driving draws at most this often. */
const IDLE_DRAW_MS = 250;

/**
 * Test builds only (`vite build --mode test`, which the E2E suite serves; main.ts imports this only
 * in that mode, so production builds do not contain it): a page nobody is driving draws the world
 * four times a second instead of every frame.
 *
 * The suite runs several pages at once on one CPU in software WebGL (SwiftShader). A page in the
 * world otherwise draws flat out for the whole test, and every one of them starves the page the
 * test is driving and, worse, a page still compiling its shaders, which on a busy machine then
 * takes over a minute to load. Only the drawing slows: every page still runs every frame of the
 * game, reading input, stepping the simulation, the network and the hover prompt, so what the
 * tests read in `window.__world` is as current as ever, and a page being driven (input in the last
 * second, or a key or button held down) draws every frame, as it would for a visitor.
 */
export function drawOnlyWhileDriven(world: WorldScene): void {
  let lastInput = -Infinity;
  const keysDown = new Set<string>();
  let buttons = 0;
  const onInput = (): void => {
    lastInput = performance.now();
  };
  const onKey = (event: KeyboardEvent): void => {
    onInput();
    if (event.type === 'keydown') keysDown.add(event.code);
    else keysDown.delete(event.code);
  };
  const onMouse = (event: MouseEvent): void => {
    onInput();
    buttons = event.buttons;
  };
  // Capturing, so nothing that stops an event on its way down can hide it.
  const options = { capture: true, passive: true };
  window.addEventListener('keydown', onKey, options);
  window.addEventListener('keyup', onKey, options);
  for (const type of ['mousedown', 'mouseup', 'mousemove'] as const) {
    window.addEventListener(type, onMouse, options);
  }
  window.addEventListener('wheel', onInput, options);
  window.addEventListener('blur', () => {
    keysDown.clear();
    buttons = 0;
  });

  const draw = world.render.bind(world);
  let lastDraw = -Infinity;
  world.render = (): void => {
    const now = performance.now();
    const driven = keysDown.size > 0 || buttons !== 0 || now - lastInput < DRIVEN_MS;
    if (!driven && now - lastDraw < IDLE_DRAW_MS) return;
    lastDraw = now;
    draw();
  };
}
