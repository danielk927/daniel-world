import type { Game } from './game/game.ts';
import type { RemoteDebugInfo } from './game/multiplayer.ts';
import type { WorldScene } from './world/scene.ts';

export interface WorldDebugState {
  readonly ready: boolean;
  readonly mode: string;
  readonly connection: 'none' | 'connecting' | 'online' | 'offline';
  readonly room: string | null;
  readonly selfId: number | null;
  readonly player: { x: number; y: number; z: number; grounded: boolean };
  readonly remotePlayers: readonly RemoteDebugInfo[];
  /** Everyone in the room, including this player (1 when alone or offline). */
  readonly playerCount: number;
  readonly prediction: { pending: number; maxCorrection: number };
  readonly renderer: {
    drawCalls: number;
    triangles: number;
    fps: number;
    frameCpuMs: number;
    quality: string;
  };
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
    get connection() {
      return game.multiplayer?.status ?? 'none';
    },
    get room() {
      return game.multiplayer?.room ?? null;
    },
    get selfId() {
      return game.multiplayer?.selfId ?? null;
    },
    get player() {
      const s = game.player.state;
      return { x: s.x, y: s.y, z: s.z, grounded: s.grounded };
    },
    get remotePlayers() {
      return game.multiplayer?.remotePlayers() ?? [];
    },
    get playerCount() {
      return 1 + (game.multiplayer?.remotePlayers().length ?? 0);
    },
    get prediction() {
      return { pending: game.player.pendingInputs, maxCorrection: game.player.lastCorrection };
    },
    get renderer() {
      return {
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        fps: fps(),
        frameCpuMs: game.frameCpuMs,
        quality: world.quality,
      };
    },
  };
  Object.defineProperty(window, '__world', { value: Object.freeze(state), configurable: true });
}
