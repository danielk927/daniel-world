import { describe, expect, it } from 'vitest';
import { Keys, PUNCH_COOLDOWN_INPUTS, parseServerMessage, type ServerMessage } from '@world/shared';
import { Room, type RoomPlayer } from './room.ts';

function setup() {
  const room = new Room('punches');
  const inboxes = new Map<number, ServerMessage[]>();
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
  const seqs = new Map<number, number>();
  /** One input per tick, as a client sends them. */
  const input = (player: RoomPlayer, keys: number): void => {
    const seq = seqs.get(player.id) ?? 0;
    seqs.set(player.id, seq + 1);
    room.enqueueInput(player, { seq, keys, yaw: 0, pitch: 0 });
    room.step();
  };
  const punches = (id: number) => inboxes.get(id)!.filter((m) => m.t === 'punch');
  return { join, input, punches };
}

describe('punches', () => {
  it('shows the others a bare-hand punch; the puncher already sees their own', () => {
    const { join, input, punches } = setup();
    const a = join(0, 5.6);
    const b = join(-5, 5.6);
    input(a, Keys.Punch);
    expect(punches(b.id)).toEqual([{ t: 'punch', id: a.id }]);
    expect(punches(a.id)).toEqual([]);
  });

  it('cannot punch with the knife out', () => {
    const { join, input, punches } = setup();
    const a = join(0, 5.6);
    const b = join(-5, 5.6);
    input(a, Keys.Punch | Keys.Armed);
    expect(punches(b.id)).toEqual([]);
  });

  it('ignores punches inside the cooldown', () => {
    const { join, input, punches } = setup();
    const a = join(0, 5.6);
    const b = join(-5, 5.6);
    for (let i = 0; i <= PUNCH_COOLDOWN_INPUTS; i++) input(a, Keys.Punch);
    expect(punches(b.id)).toHaveLength(2);
  });
});
