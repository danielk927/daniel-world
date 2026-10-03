import type { PlayerSnapshot } from '@world/shared';

/** Interpolated pose of a remote player at render time. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  grounded: boolean;
  /** Knocked out by a knife. */
  dead: boolean;
}

interface Sample extends Pose {
  time: number;
}

const CAPACITY = 32;
/** Never extrapolate further than this past the newest snapshot; freeze instead. */
const MAX_EXTRAPOLATION_MS = 150;

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  d -= Math.PI * 2 * Math.round(d / (Math.PI * 2));
  return a + d * t;
}

/**
 * Time-stamped pose history for one remote player. Fixed-size ring buffer: pushing and sampling
 * never allocate.
 */
export class SnapshotBuffer {
  private readonly samples: Sample[] = Array.from({ length: CAPACITY }, () => ({
    time: 0,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    grounded: true,
    dead: false,
  }));
  private head = -1;
  private count = 0;

  push(time: number, s: PlayerSnapshot): void {
    if (this.count > 0 && time <= this.samples[this.head]!.time) return;
    this.head = (this.head + 1) % CAPACITY;
    const sample = this.samples[this.head]!;
    sample.time = time;
    sample.x = s.x;
    sample.y = s.y;
    sample.z = s.z;
    sample.yaw = s.yaw;
    sample.pitch = s.pitch;
    sample.grounded = s.grounded;
    sample.dead = s.dead;
    this.count = Math.min(CAPACITY, this.count + 1);
  }

  /** Forget the history, so a teleport (a respawn) starts fresh instead of sliding across the room. */
  clear(): void {
    this.head = -1;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }

  private at(indexFromNewest: number): Sample {
    return this.samples[(this.head - indexFromNewest + CAPACITY * 2) % CAPACITY]!;
  }

  /** Write the pose at `time` into `out`. Returns false if there is no data yet. */
  sample(time: number, out: Pose): boolean {
    if (this.count === 0) return false;
    const newest = this.at(0);
    if (this.count === 1 || time >= newest.time) {
      if (this.count === 1) {
        Object.assign(out, newest);
        return true;
      }
      // Past the newest sample: continue the last motion briefly, then hold.
      const prev = this.at(1);
      const span = newest.time - prev.time;
      const ahead = Math.min(time - newest.time, MAX_EXTRAPOLATION_MS);
      const t = span > 0 ? 1 + ahead / span : 1;
      this.blend(prev, newest, t, out);
      out.grounded = newest.grounded;
      out.dead = newest.dead;
      return true;
    }
    for (let i = 1; i < this.count; i++) {
      const older = this.at(i);
      if (older.time <= time) {
        const newer = this.at(i - 1);
        const t = (time - older.time) / (newer.time - older.time);
        this.blend(older, newer, t, out);
        out.grounded = t < 0.5 ? older.grounded : newer.grounded;
        out.dead = t < 0.5 ? older.dead : newer.dead;
        return true;
      }
    }
    // Older than everything we have: hold the oldest pose.
    const oldest = this.at(this.count - 1);
    Object.assign(out, oldest);
    return true;
  }

  private blend(a: Sample, b: Sample, t: number, out: Pose): void {
    out.x = a.x + (b.x - a.x) * t;
    out.y = a.y + (b.y - a.y) * t;
    out.z = a.z + (b.z - a.z) * t;
    out.yaw = lerpAngle(a.yaw, b.yaw, t);
    out.pitch = a.pitch + (b.pitch - a.pitch) * t;
  }
}

/**
 * Maps server ticks onto the local clock. Tracks the smallest observed delay so network jitter
 * is absorbed by the interpolation delay rather than showing up as stutter.
 */
export class ServerClock {
  private offset = 0;
  private initialized = false;

  /** Record a snapshot's server time (ms) as it arrives at local time `now` (ms). */
  observe(serverTime: number, now: number): void {
    const sample = now - serverTime;
    if (!this.initialized || sample < this.offset) {
      this.offset = sample;
      this.initialized = true;
    } else {
      // Latency can grow (or clocks drift); follow slowly so one late packet does not jerk time.
      this.offset += (sample - this.offset) * 0.02;
    }
  }

  /** Server time corresponding to local time `now`. */
  serverTime(now: number): number {
    return now - this.offset;
  }

  reset(): void {
    this.initialized = false;
  }
}
