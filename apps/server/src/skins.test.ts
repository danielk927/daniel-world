import { describe, expect, it } from 'vitest';
import {
  KNIFE_COOLDOWN_INPUTS,
  Keys,
  TICK_RATE,
  parseServerMessage,
  type ServerMessage,
} from '@world/shared';
import { Room, type RoomPlayer } from './room.ts';

/** Long enough for a knife thrown at the floor to land. */
const FLIGHT = Math.round(0.25 * TICK_RATE);

function setup() {
  const room = new Room('skins');
  const inboxes = new Map<number, ServerMessage[]>();
  const seqs = new Map<number, number>();
  let nextId = 1;
  const join = (x: number, z: number): RoomPlayer => {
    const id = nextId++;
    const inbox: ServerMessage[] = [];
    inboxes.set(id, inbox);
    return room.add({
      id,
      name: `P${id}`,
      spawn: { x, z, yaw: 0 },
      send: (data) => {
        const message = parseServerMessage(data);
        if (message && message.t !== 'snap') inbox.push(message);
      },
    });
  };
  /** Wait out the cooldown, then throw a knife at the floor in front of `player`. */
  const throwAtFloor = (player: RoomPlayer): void => {
    for (let i = 0; i <= KNIFE_COOLDOWN_INPUTS; i++) {
      const seq = seqs.get(player.id) ?? 0;
      seqs.set(player.id, seq + 1);
      const last = i === KNIFE_COOLDOWN_INPUTS;
      room.enqueueInput(player, {
        seq,
        keys: Keys.Armed | (last ? Keys.Throw : 0),
        yaw: 0,
        pitch: -1.2,
      });
    }
    for (let i = 0; i <= KNIFE_COOLDOWN_INPUTS + FLIGHT; i++) room.step();
  };
  const received = <T extends ServerMessage['t']>(id: number, t: T) =>
    inboxes.get(id)!.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
  return { room, join, throwAtFloor, received };
}

describe('knife skins in a room', () => {
  it("throw and stick each cook's knife as they carry it, for everyone", () => {
    const { join, throwAtFloor, received } = setup();
    const thrower = join(0, 5.6);
    const watcher = join(-3, 5.6);
    thrower.prefs = { chef: true, skin: 'karambit', finish: 'fade' };
    throwAtFloor(thrower);
    expect(received(watcher.id, 'knife')).toMatchObject([{ skin: 'karambit', finish: 'fade' }]);
    expect(received(watcher.id, 'stuck')).toMatchObject([
      { knife: { skin: 'karambit', finish: 'fade' } },
    ]);
  });

  it('say nothing about the chef’s knife as it comes, as before skins', () => {
    const { join, throwAtFloor, received } = setup();
    const thrower = join(0, 5.6);
    throwAtFloor(thrower);
    const [thrown] = received(thrower.id, 'knife');
    const [stuck] = received(thrower.id, 'stuck');
    expect(thrown).not.toHaveProperty('skin');
    expect(stuck!.knife).not.toHaveProperty('skin');
  });

  it('keep a stuck knife as it was thrown when its thrower changes knife, for newcomers too', () => {
    const { room, join, throwAtFloor } = setup();
    const thrower = join(0, 5.6);
    thrower.prefs = { chef: true, skin: 'butterfly', finish: 'web' };
    throwAtFloor(thrower);
    room.setPrefs(thrower, { chef: true, skin: 'gut', finish: 'case' });
    throwAtFloor(thrower);
    expect(room.stuckKnives().map((k) => [k.skin, k.finish])).toEqual([
      ['butterfly', 'web'],
      ['gut', 'case'],
    ]);
  });

  it('settle a finish the knife does not come in before telling anyone', () => {
    const { join, throwAtFloor, received } = setup();
    const thrower = join(0, 5.6);
    thrower.prefs = { chef: true, skin: 'talon', finish: 'damascus' };
    throwAtFloor(thrower);
    expect(received(thrower.id, 'knife')).toMatchObject([{ skin: 'talon', finish: 'marble' }]);
  });

  it('tell everyone when a cook changes knife', () => {
    const { room, join, received } = setup();
    const cook = join(0, 5.6);
    const watcher = join(-3, 5.6);
    room.setPrefs(cook, { chef: true, skin: 'm9', finish: 'tiger' });
    expect(received(watcher.id, 'prefs')).toEqual([
      { t: 'prefs', id: cook.id, prefs: { chef: true, skin: 'm9', finish: 'tiger' } },
    ]);
    // The same knife again is not news.
    room.setPrefs(cook, { chef: true, skin: 'm9', finish: 'tiger' });
    expect(received(watcher.id, 'prefs')).toHaveLength(1);
    expect(room.playerList().find((p) => p.id === cook.id)?.prefs).toMatchObject({ skin: 'm9' });
  });
});
