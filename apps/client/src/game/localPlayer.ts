import type { Vector3 } from 'three';
import {
  copyPlayerState,
  createPlayerState,
  stepPlayer,
  type PlayerInput,
  type PlayerState,
} from '@world/shared';

/**
 * The player on this machine. Runs the shared simulation at the fixed tick rate and interpolates
 * between the last two ticks for rendering, so movement is smooth at any frame rate.
 */
export class LocalPlayer {
  readonly state: PlayerState = createPlayerState();
  private readonly previous: PlayerState = createPlayerState();
  private readonly input: PlayerInput = { keys: 0, yaw: 0, pitch: 0 };

  /** Advance one tick. Returns the input that was applied (reused object, copy to keep it). */
  tick(keys: number, yaw: number, pitch: number): PlayerInput {
    this.input.keys = keys;
    this.input.yaw = yaw;
    this.input.pitch = pitch;
    copyPlayerState(this.state, this.previous);
    stepPlayer(this.state, this.input);
    return this.input;
  }

  /** Feet position blended between the previous and current tick. */
  renderPosition(alpha: number, out: Vector3): Vector3 {
    const p = this.previous;
    const s = this.state;
    return out.set(p.x + (s.x - p.x) * alpha, p.y + (s.y - p.y) * alpha, p.z + (s.z - p.z) * alpha);
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.state.vx, this.state.vz);
  }

  reset(x?: number, z?: number, yaw?: number): void {
    const fresh = createPlayerState(x, z, yaw);
    copyPlayerState(fresh, this.state);
    copyPlayerState(fresh, this.previous);
  }
}
