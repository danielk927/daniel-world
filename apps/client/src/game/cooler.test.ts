import { describe, expect, it, vi } from 'vitest';
import {
  COOLER_HITS_TO_OPEN,
  COOLER_OPEN_DELAY_INPUTS,
  EYE_HEIGHT,
  KNIFE_EMBED,
  ROOM_HALF_X,
  createPlayerState,
  type CoolerDent,
} from '@world/shared';
import type { CoolerDoor } from '../world/cooler.ts';
import { CoolerControl } from './cooler.ts';
import { LocalPlayer } from './localPlayer.ts';

const EAST = -Math.PI / 2;

function setup() {
  const door = { reset: vi.fn(), hit: vi.fn() };
  const player = new LocalPlayer();
  const fistLands = vi.fn();
  const control = new CoolerControl(door as unknown as CoolerDoor, player, fistLands);
  // Standing at the walk-in's door, looking straight at it.
  const atDoor = createPlayerState(ROOM_HALF_X - 0.7, -3, EAST);
  atDoor.yaw = EAST;
  return { door, player, fistLands, control, atDoor };
}

const dent = (z = -3): CoolerDent => ({ z, y: EYE_HEIGHT, by: 'fist' });

describe("the walk-in's door, from this player's side", () => {
  it('counts a punch playing solo, and shows it as the fist lands', () => {
    const { door, control, atDoor, fistLands } = setup();
    control.punched(atDoor, 10.13, true);
    expect(control.hits).toBe(1);
    control.update(10.1);
    expect(door.hit).not.toHaveBeenCalled();
    control.update(10.14);
    expect(door.hit).toHaveBeenCalledWith(dent(), 10.14);
    expect(fistLands).toHaveBeenCalledOnce();
  });

  it('leaves the count to the server online, but still feels the fist land', () => {
    const { door, control, atDoor, fistLands } = setup();
    control.punched(atDoor, 5.13, false);
    control.update(5.2);
    expect(control.hits).toBe(0);
    expect(door.hit).not.toHaveBeenCalled();
    expect(fistLands).toHaveBeenCalledOnce();
  });

  it("shows the server's word on this player's punch no sooner than their fist gets there", () => {
    const { door, control, atDoor } = setup();
    control.punched(atDoor, 5.13, false);
    // A quick server: its word arrives before the fist does.
    control.serverHit({ t: 'cooler', from: 1, dent: dent() }, 5.05, 0, true);
    control.update(5.08);
    expect(door.hit).not.toHaveBeenCalled();
    control.update(5.13);
    expect(door.hit).toHaveBeenCalledOnce();
  });

  it('shows hits in the order they were made, each when it arrives', () => {
    const { door, control } = setup();
    control.serverHit({ t: 'cooler', from: 2, dent: dent(-3.2) }, 1, 0.5, false);
    control.serverHit({ t: 'cooler', from: 3, dent: dent(-2.8) }, 1, 0.2, false);
    control.update(1.3);
    expect(door.hit).not.toHaveBeenCalled();
    control.update(1.5);
    expect(door.hit.mock.calls.map(([d]) => (d as CoolerDent).z)).toEqual([-3.2, -2.8]);
  });

  it('opens the doorway from the input the server names on the hit that bursts it', () => {
    const { control, player } = setup();
    for (let i = 0; i < COOLER_HITS_TO_OPEN - 1; i++) {
      control.serverHit({ t: 'cooler', from: 2, dent: dent() }, 0, 0, false);
    }
    expect(player.coolerOpenFrom).toBe(Infinity);
    control.serverHit({ t: 'cooler', from: 2, dent: dent(), openFrom: 321 }, 0, 0, false);
    expect(control.open).toBe(true);
    expect(player.coolerOpenFrom).toBe(321);
  });

  it('opens it a little ahead of this input playing solo, as the server would', () => {
    const { control, player, atDoor } = setup();
    for (let i = 0; i < 40; i++) player.tick(0, EAST, 0, false);
    for (let i = 0; i < COOLER_HITS_TO_OPEN; i++) control.punched(atDoor, i, true);
    expect(control.open).toBe(true);
    expect(player.coolerOpenFrom).toBe(40 + COOLER_OPEN_DELAY_INPUTS);
  });

  it('counts a knife this screen flew into the door solo, and nothing else', () => {
    const { control } = setup();
    control.knifeStuck(
      { id: -1, x: ROOM_HALF_X + KNIFE_EMBED, y: 1.2, z: -3, dx: 1, dy: 0, dz: 0 },
      2,
    );
    control.knifeStuck(
      { id: -2, x: ROOM_HALF_X + KNIFE_EMBED, y: 1.2, z: 0, dx: 1, dy: 0, dz: 0 },
      2,
    );
    expect(control.hits).toBe(1);
  });

  it('starts over from a welcome: open already means open for every input', () => {
    const { control, door, player } = setup();
    const dents = Array.from({ length: COOLER_HITS_TO_OPEN }, () => dent());
    control.reset(dents);
    expect(door.reset).toHaveBeenCalledWith(dents);
    expect(player.coolerOpenFrom).toBe(0);
    control.reset([]);
    expect(player.coolerOpenFrom).toBe(Infinity);
    expect(control.hits).toBe(0);
  });
});
