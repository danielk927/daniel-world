import { describe, expect, it } from 'vitest';
import {
  GROUND_ACCEL,
  Keys,
  TICK_SECONDS,
  WALK_SPEED,
  createPlayerState,
  stepPlayer,
  type InputMessage,
  type PlayerSnapshot,
  type PlayerState,
} from '@world/shared';
import { Vector3 } from 'three';
import { LocalPlayer } from './localPlayer.ts';

/** A stand-in for the room server: applies inputs `latency` ticks late, like the real one. */
class FakeServer {
  readonly state: PlayerState = createPlayerState();
  private readonly inbox: InputMessage[][] = [];
  ack = -1;
  private readonly latency: number;
  constructor(latency: number) {
    this.latency = latency;
  }

  receive(input: InputMessage, dropped = false): void {
    const due = this.latency;
    while (this.inbox.length <= due) this.inbox.push([]);
    if (!dropped) this.inbox[due]!.push({ ...input });
  }

  tick(): PlayerSnapshot {
    for (const input of this.inbox.shift() ?? []) {
      stepPlayer(this.state, input);
      this.ack = input.seq;
    }
    // JSON round trip, exactly like the wire.
    return JSON.parse(JSON.stringify({ id: 1, ...this.state, ack: this.ack })) as PlayerSnapshot;
  }
}

function inputAt(i: number): [number, number, number] {
  const keys = [
    Keys.Forward,
    Keys.Forward | Keys.Sprint,
    Keys.Left | Keys.Jump,
    Keys.Back,
    0,
    Keys.Right,
  ][Math.floor(i / 7) % 6]!;
  return [keys, Math.sin(i * 0.05) * 2.5, Math.cos(i * 0.04) * 0.4];
}

describe('LocalPlayer prediction and reconciliation', () => {
  it('never needs a correction when the server sees every input', () => {
    const player = new LocalPlayer();
    const server = new FakeServer(3);
    for (let i = 0; i < 500; i++) {
      const input = player.tick(...inputAt(i), true);
      server.receive(input);
      player.reconcile(server.tick());
    }
    expect(player.lastCorrection).toBe(0);
    expect(player.pendingInputs).toBeLessThanOrEqual(4);
  });

  it('converges on the server state when inputs are lost', () => {
    const player = new LocalPlayer();
    const server = new FakeServer(2);
    for (let i = 0; i < 300; i++) {
      const input = player.tick(...inputAt(i), true);
      server.receive(input, i % 37 === 5);
      player.reconcile(server.tick());
    }
    expect(player.lastCorrection).toBeGreaterThan(0);
    // Stop moving and let everything drain: prediction must equal the server exactly.
    for (let i = 0; i < 20; i++) {
      server.receive(player.tick(0, 0, 0, true));
      player.reconcile(server.tick());
    }
    expect(player.state).toEqual(server.state);
  });

  it('smooths small corrections and snaps big ones', () => {
    const player = new LocalPlayer();
    player.tick(0, 0, 0, true);
    const out = new Vector3();
    const before = player.renderPosition(1, 0, out).clone();
    const nudged = {
      id: 1,
      ...player.state,
      x: player.state.x + 0.5,
      dead: false,
      armed: true,
      ack: 0,
    };
    player.reconcile(nudged);
    // Right after the correction the rendered position has not jumped...
    expect(player.renderPosition(1, 0, out).distanceTo(before)).toBeLessThan(1e-9);
    // ...and it glides to the corrected spot.
    for (let i = 0; i < 60; i++) player.renderPosition(1, 1 / 60, out);
    expect(out.x).toBeCloseTo(nudged.x, 3);

    player.reconcile({ ...nudged, x: nudged.x + 20 });
    expect(player.renderPosition(1, 0, out).x).toBeCloseTo(nudged.x + 20, 6);
  });

  it('draws between the last two ticks, so it never runs ahead of the simulation', () => {
    const player = new LocalPlayer();
    for (let i = 0; i < 5; i++) player.tick(Keys.Forward, 0, 0, false);
    const before = { ...player.state };
    player.tick(Keys.Forward, 0, 0, false);
    const out = new Vector3();
    expect(player.renderPosition(0, 0, out).z).toBeCloseTo(before.z, 9);
    expect(player.renderPosition(1, 0, out).z).toBeCloseTo(player.state.z, 9);
    // Still continuous across the next tick.
    const end = out.clone();
    player.tick(Keys.Forward, 0, 0, false);
    expect(player.renderPosition(0, 0, out).distanceTo(end)).toBeLessThan(1e-9);
  });

  it('turns round smoothly, without popping or springing back', () => {
    const player = new LocalPlayer();
    const out = new Vector3();
    const dt = 1 / 144;
    let accumulator = 0;
    let last = player.renderPosition(0, dt, out).x;
    let maxSpeed = 0;
    let maxChange = 0;
    let lastSpeed = 0;
    // Strafe left and right, switching keys at uneven moments within a tick, on a 144 Hz display.
    for (let frame = 0; frame < 144 * 3; frame++) {
      const keys = Math.floor(frame / 37) % 2 === 0 ? Keys.Left : Keys.Right;
      accumulator += dt;
      while (accumulator >= TICK_SECONDS) {
        player.tick(keys, 0, 0, false);
        accumulator -= TICK_SECONDS;
      }
      const x = player.renderPosition(accumulator / TICK_SECONDS, dt, out).x;
      const speed = (x - last) / dt;
      maxSpeed = Math.max(maxSpeed, Math.abs(speed));
      if (frame > 0) maxChange = Math.max(maxChange, Math.abs(speed - lastSpeed));
      lastSpeed = speed;
      last = x;
    }
    // Never faster than walking, and the speed changes no more than one tick's acceleration.
    expect(maxSpeed).toBeLessThanOrEqual(WALK_SPEED + 1e-6);
    expect(maxChange).toBeLessThanOrEqual(GROUND_ACCEL * TICK_SECONDS + 0.01);
  });
});
