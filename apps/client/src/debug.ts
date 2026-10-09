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
  /** How far into its inspect the knife is, in seconds, or null if it is not being inspected. */
  readonly inspectTime: number | null;
  /** Mid-punch with the bare hand. */
  readonly punching: boolean;
  /**
   * The kitchen computer: its machine's state, how many DOOM frames it has shown, and how many keys
   * DOOM has been told are held down.
   */
  readonly computer: { state: string; frames: number; keys: number };
  /** Knocked out by a knife, waiting to respawn. */
  readonly knockedOut: boolean;
  /** The arm is on screen: in the world, standing, and no menu or panel over it. */
  readonly arm: boolean;
  /** Station labels and name tags show over the world, uncovered by a menu, panel or knockout. */
  readonly labels: boolean;
  /** The knife this player carries, as the hand on screen holds it. */
  readonly knife: { skin: string; finish: string };
  /**
   * Knives stuck around the room, and in the air, as this screen shows them; `looks` counts those
   * drawn of each look, keyed `skin/finish`, and `tips` is where each stuck knife's tip is, oldest
   * first. `maxCorrection` is the farthest the server has moved a knife from where this screen flew
   * it to stick, in meters.
   */
  readonly knives: {
    stuck: number;
    flying: number;
    looks: Record<string, number>;
    tips: { x: number; y: number; z: number }[];
    maxCorrection: number;
  };
  /**
   * The walk-in cooler's door: hits the room has decided, whether that has burst it open, and how
   * far it has swung open on this screen, in radians (a right angle is fully open).
   */
  readonly cooler: { hits: number; open: boolean; angle: number };
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
    get inspectTime() {
      return world.viewmodel.inspectTime;
    },
    get punching() {
      return world.viewmodel.punching;
    },
    get computer() {
      return { state: game.desk.state, frames: game.desk.frames, keys: game.desk.keysHeld };
    },
    get knockedOut() {
      return game.knockedOut;
    },
    get arm() {
      return world.viewmodel.isShown;
    },
    get labels() {
      return game.labelsShown;
    },
    get knife() {
      const { skin, finish } = world.viewmodel.look;
      return { skin, finish };
    },
    get knives() {
      return {
        stuck: world.knives.stuckCount,
        flying: world.knives.flyingCount,
        looks: world.knives.drawnLooks(),
        tips: world.knives.stuckKnives().map(({ x, y, z }) => ({ x, y, z })),
        maxCorrection: world.knives.maxCorrection,
      };
    },
    get cooler() {
      return { hits: game.cooler.hits, open: game.cooler.open, angle: world.cooler.angle };
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
