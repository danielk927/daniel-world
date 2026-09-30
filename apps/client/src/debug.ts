import type { Game } from './game/game.ts';
import type { WorldScene } from './world/scene.ts';

export interface WorldDebugState {
  readonly ready: boolean;
  readonly mode: string;
  readonly player: { x: number; y: number; z: number; grounded: boolean };
  readonly renderer: { drawCalls: number; triangles: number; fps: number };
}

declare global {
  interface Window {
    __world?: WorldDebugState;
  }
}

/**
 * Read-only view of game state for E2E tests and debugging. Only installed in dev and test builds.
 * Every getter returns a fresh copy, so callers cannot mutate the game.
 */
export function installDebugHooks(game: Game, world: WorldScene, fps: () => number): void {
  const info = world.renderer.info;
  const state: WorldDebugState = {
    get ready() {
      return true;
    },
    get mode() {
      return game.mode;
    },
    get player() {
      const s = game.player.state;
      return { x: s.x, y: s.y, z: s.z, grounded: s.grounded };
    },
    get renderer() {
      return { drawCalls: info.render.calls, triangles: info.render.triangles, fps: fps() };
    },
  };
  Object.defineProperty(window, '__world', { value: Object.freeze(state), configurable: true });
}
