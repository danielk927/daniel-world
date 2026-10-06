import { describe, expect, it } from 'vitest';
import {
  Keys,
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
    const before = player.renderPosition(0, 0, 0, 0, 0, out).clone();
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
    expect(player.renderPosition(0, 0, 0, 0, 0, out).distanceTo(before)).toBeLessThan(1e-9);
    // ...and it glides to the corrected spot.
    for (let i = 0; i < 60; i++) player.renderPosition(0, 1 / 60, 0, 0, 0, out);
    expect(out.x).toBeCloseTo(nudged.x, 3);

    player.reconcile({ ...nudged, x: nudged.x + 20 });
    expect(player.renderPosition(0, 0, 0, 0, 0, out).x).toBeCloseTo(nudged.x + 20, 6);
  });

  it('draws a fresh key press at once, not a tick later', () => {
    const player = new LocalPlayer();
    player.tick(0, 0, 0, false);
    const out = new Vector3();
    // Halfway to the next tick, standing still: drawn exactly where the simulation is.
    player.renderPosition(0.5, 0, 0, 0, 0, out);
    expect(out.z).toBeCloseTo(player.state.z, 9);
    // W goes down between ticks: the drawn position already starts forward (north, -z).
    player.renderPosition(0.5, 0, Keys.Forward, 0, 0, out);
    expect(out.z).toBeLessThan(player.state.z - 1e-4);
  });

  it('stays continuous across a tick while a key is held', () => {
    const player = new LocalPlayer();
    for (let i = 0; i < 5; i++) player.tick(Keys.Forward, 0, 0, false);
    const out = new Vector3();
    const before = player.renderPosition(0.999, 0, Keys.Forward, 0, 0, out).clone();
    player.tick(Keys.Forward, 0, 0, false);
    const after = player.renderPosition(0, 0, Keys.Forward, 0, 0, out);
    expect(after.distanceTo(before)).toBeLessThan(0.002);
  });
});
