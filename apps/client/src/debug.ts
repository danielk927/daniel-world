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
  /** Where the player is looking, in radians. */
  readonly look: { yaw: number; pitch: number };
  /** The camera as last drawn: where the player sees from, which can trail the simulation. */
  readonly view: { x: number; y: number; z: number };
  /** Holding the knife rather than the bare hand. */
  readonly armed: boolean;
  /** Taking a long look at the knife (I). */
  readonly inspecting: boolean;
  /** Mid-punch with the bare hand. */
  readonly punching: boolean;
  /** Knocked out by a knife, waiting to respawn. */
  readonly knockedOut: boolean;
  /** Knives stuck around the room, and in the air, as this screen shows them. */
  readonly knives: { stuck: number; flying: number };
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
    /** The quality governor's level (0 is best), or null on the low tier. */
    level: number | null;
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
    get look() {
      return { yaw: game.input.yaw, pitch: game.input.pitch };
    },
    get view() {
      const p = world.camera.position;
      return { x: p.x, y: p.y, z: p.z };
    },
    get armed() {
      return game.armed;
    },
    get inspecting() {
      return world.viewmodel.inspecting;
    },
    get punching() {
      return world.viewmodel.punching;
    },
    get knockedOut() {
      return game.knockedOut;
    },
    get knives() {
      return { stuck: world.knives.stuckCount, flying: world.knives.flyingCount };
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
        level: world.renderLevel,
      };
    },
  };
  Object.defineProperty(window, '__world', { value: Object.freeze(state), configurable: true });
}
