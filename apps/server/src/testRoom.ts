import {
  DEATH_SECONDS,
  KNIFE_COOLDOWN_INPUTS,
  Keys,
  RESPAWN_PROTECTION_SECONDS,
  TICK_RATE,
  parseServerMessage,
  type ServerMessage,
} from '@world/shared';
import { Room, type RoomPlayer } from './room.ts';

/** Long enough for any knife thrown across the few meters of these rooms to land. */
export const FLIGHT = Math.round(0.25 * TICK_RATE);

/** Where the cook who is thrown at stands, in the aisle by the dining room doors. */
const TARGET = { x: 0, z: 3.2 } as const;
/** Where the cooks who throw stand, a few meters south of them: clear lines of fire, side by side. */
const THROWERS = [0, -0.6, 0.6, -1.2, 1.2] as const;

/**
 * A room for tests about knives, stepped by hand, with every cook's inbox: each message the room
 * sent them, parsed (snapshots left out).
 */
export function knifeRoom() {
  const room = new Room('knives');
  const inboxes = new Map<number, ServerMessage[]>();
  const seqs = new Map<number, number>();
  let nextId = 1;
  let throwers = 0;

  const add = (
    x: number,
    z: number,
    options: { resident?: boolean; chef?: boolean } = {},
  ): RoomPlayer => {
    const id = nextId++;
    const inbox: ServerMessage[] = [];
    inboxes.set(id, inbox);
    return room.add({
      id,
      name: options.resident ? 'Resident' : `P${id}`,
      spawn: { x, z, yaw: 0 },
      resident: options.resident ?? false,
      prefs: { chef: options.chef ?? true },
      send: (data) => {
        const message = parseServerMessage(data);
        if (message && message.t !== 'snap') inbox.push(message);
      },
    });
  };
  /** A cook to be thrown at, standing where a knife from any of the throwers reaches them. */
  const target = (): RoomPlayer => add(TARGET.x, TARGET.z);
  /** A cook to throw from the next place along the south side of the target. */
  const thrower = (options: { resident?: boolean } = {}): RoomPlayer =>
    add(THROWERS[throwers++]!, 5.6, options);

  /** Queue one input for a player, one after another as a client numbers them. */
  const input = (player: RoomPlayer, keys: number, yaw = 0, pitch = 0): void => {
    const seq = seqs.get(player.id) ?? 0;
    seqs.set(player.id, seq + 1);
    room.enqueueInput(player, { seq, keys: keys | Keys.Armed, yaw, pitch });
  };
  const steps = (n: number): void => {
    for (let i = 0; i < n; i++) room.step();
  };

  /**
   * `from` throws one knife at `to`, once the cooldown since their last allows, and the room steps
   * on until it has landed.
   */
  const throwAt = (from: RoomPlayer, to: RoomPlayer): void => {
    const yaw = Math.atan2(from.state.x - to.state.x, from.state.z - to.state.z);
    for (let i = 0; i < KNIFE_COOLDOWN_INPUTS; i++) input(from, 0, yaw);
    input(from, Keys.Throw, yaw, -0.1);
    steps(KNIFE_COOLDOWN_INPUTS + 1 + FLIGHT);
  };
  /** `from` throws at `to` `count` times over. */
  const throwsAt = (from: RoomPlayer, to: RoomPlayer, count: number): void => {
    for (let i = 0; i < count; i++) throwAt(from, to);
  };
  /** The knocked-out `player` gets back up, and stands where a knife can hit them again. */
  const standUp = (player: RoomPlayer): void => {
    steps(Math.round(DEATH_SECONDS * TICK_RATE));
    steps(Math.round(RESPAWN_PROTECTION_SECONDS * TICK_RATE));
    // Back at a spawn point; put them where the throwers aim.
    Object.assign(player.state, { x: TARGET.x, z: TARGET.z, vx: 0, vz: 0 });
  };

  const received = <T extends ServerMessage['t']>(id: number, t: T) =>
    inboxes.get(id)!.filter((m): m is Extract<ServerMessage, { t: T }> => m.t === t);
  return { room, add, target, thrower, input, steps, throwAt, throwsAt, standUp, received };
}
