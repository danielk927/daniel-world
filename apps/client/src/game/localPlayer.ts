import { Vector3 } from 'three';
import {
  copyPlayerState,
  createPlayerState,
  stepPlayer,
  type InputMessage,
  type PlayerSnapshot,
  type PlayerState,
} from '@world/shared';

/** Unacknowledged inputs kept for replay. 128 ticks is 6.4 s, far beyond any sane round trip. */
const PENDING_CAPACITY = 128;
/** Corrections bigger than this are teleports (respawn, reconnect) and snap instead of smoothing. */
const SNAP_DISTANCE = 4;
/** How fast a visual correction fades, per second. */
const ERROR_DECAY = 12;

/**
 * The player on this machine.
 *
 * Runs the shared simulation at the fixed tick rate (client-side prediction), keeps every input the
 * server has not acknowledged yet, and on each snapshot rewinds to the server state and replays
 * them (reconciliation). Because the simulation is deterministic the replay normally lands exactly
 * where prediction was; any difference is hidden by a short visual blend.
 */
export class LocalPlayer {
  readonly state: PlayerState = createPlayerState();
  private readonly previous: PlayerState = createPlayerState();
  private readonly input: InputMessage = { t: 'input', seq: 0, keys: 0, yaw: 0, pitch: 0 };
  private sequence = 0;

  private readonly pending: InputMessage[] = Array.from({ length: PENDING_CAPACITY }, () => ({
    t: 'input' as const,
    seq: 0,
    keys: 0,
    yaw: 0,
    pitch: 0,
  }));
  private pendingStart = 0;
  private pendingCount = 0;

  /** Visual offset left over from the last correction; decays to zero. */
  readonly error = new Vector3();
  /** Largest correction seen, for debugging and tests. */
  lastCorrection = 0;

  /**
   * Advance one tick. When `record` is true the input is kept for reconciliation (we are online).
   * Returns the input message to send (a reused object; send it before the next tick).
   */
  tick(keys: number, yaw: number, pitch: number, record: boolean): InputMessage {
    const input = this.input;
    input.seq = this.sequence++;
    input.keys = keys;
    input.yaw = yaw;
    input.pitch = pitch;
    copyPlayerState(this.state, this.previous);
    stepPlayer(this.state, input);
    if (record) this.remember(input);
    return input;
  }

  private remember(input: InputMessage): void {
    if (this.pendingCount === PENDING_CAPACITY) {
      // The server stopped acknowledging; forget the oldest.
      this.pendingStart = (this.pendingStart + 1) % PENDING_CAPACITY;
      this.pendingCount--;
    }
    const slot = this.pending[(this.pendingStart + this.pendingCount) % PENDING_CAPACITY]!;
    slot.seq = input.seq;
    slot.keys = input.keys;
    slot.yaw = input.yaw;
    slot.pitch = input.pitch;
    this.pendingCount++;
  }

  /** The sequence number the next input will get. */
  get nextSeq(): number {
    return this.sequence;
  }

  get pendingInputs(): number {
    return this.pendingCount;
  }

  /** Apply the authoritative state from a snapshot and replay inputs the server has not seen yet. */
  reconcile(server: PlayerSnapshot): void {
    while (this.pendingCount > 0 && this.pending[this.pendingStart]!.seq <= server.ack) {
      this.pendingStart = (this.pendingStart + 1) % PENDING_CAPACITY;
      this.pendingCount--;
    }
    const s = this.state;
    const oldX = s.x;
    const oldY = s.y;
    const oldZ = s.z;
    s.x = server.x;
    s.y = server.y;
    s.z = server.z;
    s.vx = server.vx;
    s.vy = server.vy;
    s.vz = server.vz;
    s.yaw = server.yaw;
    s.pitch = server.pitch;
    s.grounded = server.grounded;
    for (let i = 0; i < this.pendingCount; i++) {
      stepPlayer(s, this.pending[(this.pendingStart + i) % PENDING_CAPACITY]!);
    }

    const dx = oldX - s.x;
    const dy = oldY - s.y;
    const dz = oldZ - s.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance === 0) return;
    this.lastCorrection = Math.max(this.lastCorrection, distance);
    // Shift the interpolation segment with the correction so rendering stays continuous.
    this.previous.x -= dx;
    this.previous.y -= dy;
    this.previous.z -= dz;
    if (distance > SNAP_DISTANCE) {
      this.error.set(0, 0, 0);
      copyPlayerState(s, this.previous);
    } else {
      this.error.x += dx;
      this.error.y += dy;
      this.error.z += dz;
    }
  }

  /** Feet position for rendering: blended between ticks, plus any fading correction. */
  renderPosition(alpha: number, dt: number, out: Vector3): Vector3 {
    this.error.multiplyScalar(Math.exp(-ERROR_DECAY * dt));
    if (this.error.lengthSq() < 1e-8) this.error.set(0, 0, 0);
    const p = this.previous;
    const s = this.state;
    return out.set(
      p.x + (s.x - p.x) * alpha + this.error.x,
      p.y + (s.y - p.y) * alpha + this.error.y,
      p.z + (s.z - p.z) * alpha + this.error.z,
    );
  }

  get horizontalSpeed(): number {
    return Math.hypot(this.state.vx, this.state.vz);
  }

  /** Jump to a known state (spawn, or the server's welcome) and forget pending inputs. */
  reset(from?: PlayerSnapshot): void {
    const fresh = createPlayerState();
    if (from) {
      fresh.x = from.x;
      fresh.y = from.y;
      fresh.z = from.z;
      fresh.vx = from.vx;
      fresh.vy = from.vy;
      fresh.vz = from.vz;
      fresh.yaw = from.yaw;
      fresh.pitch = from.pitch;
      fresh.grounded = from.grounded;
    }
    copyPlayerState(fresh, this.state);
    copyPlayerState(fresh, this.previous);
    this.pendingStart = 0;
    this.pendingCount = 0;
    this.error.set(0, 0, 0);
    this.lastCorrection = 0;
  }
}
