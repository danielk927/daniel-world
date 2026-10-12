import { describe, expect, it } from 'vitest';
import { KNIFE_COOLDOWN_INPUTS, Keys } from '@world/shared';
import { FLIGHT, knifeRoom } from './testRoom.ts';

describe('scores', () => {
  it('start at nothing for every cook, Chef Skinner among them', () => {
    const { room, add } = knifeRoom();
    const a = add(0, 5.6);
    const chef = add(3, 5.6, { resident: true });
    expect(room.scoreList()).toEqual([
      { id: a.id, kills: 0, deaths: 0, assists: 0 },
      { id: chef.id, kills: 0, deaths: 0, assists: 0 },
    ]);
  });

  it('are not changed by a hit, only by the knockout it leads to', () => {
    const { room, thrower, target, throwsAt, throwAt } = knifeRoom();
    const a = thrower();
    const b = target();
    throwsAt(a, b, 2);
    expect(room.scoreList().every((s) => s.kills + s.deaths + s.assists === 0)).toBe(true);
    throwAt(a, b);
    expect(room.scoreList()).toEqual([
      { id: a.id, kills: 1, deaths: 0, assists: 0 },
      { id: b.id, kills: 0, deaths: 1, assists: 0 },
    ]);
  });

  it('give the knockout to the cook who landed it, and a death to the one who fell', () => {
    const { thrower, target, throwsAt, received } = knifeRoom();
    const a = thrower();
    const b = target();
    const watcher = thrower();
    throwsAt(a, b, 3);
    // Everyone is told the same rows, with the knockout: just the two it changed.
    for (const cook of [a, b, watcher]) {
      expect(received(cook.id, 'kill'), `${cook.name} heard`).toMatchObject([
        {
          scores: [
            { id: a.id, kills: 1, deaths: 0, assists: 0 },
            { id: b.id, kills: 0, deaths: 1, assists: 0 },
          ],
        },
      ]);
    }
    expect(received(watcher.id, 'hit')).toHaveLength(2);
  });

  it('count an assist for a cook who hit the victim, and did not land the knockout', () => {
    const { room, thrower, target, throwAt, throwsAt, received } = knifeRoom();
    const [a, c] = [thrower(), thrower()] as const;
    const b = target();
    throwAt(c, b);
    throwsAt(a, b, 2);
    expect(b.deadUntil).not.toBeNull();
    expect(room.scoreList()).toEqual([
      { id: a.id, kills: 1, deaths: 0, assists: 0 },
      { id: c.id, kills: 0, deaths: 0, assists: 1 },
      { id: b.id, kills: 0, deaths: 1, assists: 0 },
    ]);
    // The knockout carries every row it changed, the assist's too.
    const [kill] = received(b.id, 'kill');
    expect(kill!.scores).toEqual(
      expect.arrayContaining([
        { id: a.id, kills: 1, deaths: 0, assists: 0 },
        { id: b.id, kills: 0, deaths: 1, assists: 0 },
        { id: c.id, kills: 0, deaths: 0, assists: 1 },
      ]),
    );
    expect(kill!.scores).toHaveLength(3);
  });

  it('count one assist for a cook who hit the victim twice, not two', () => {
    const { room, thrower, target, throwAt, throwsAt } = knifeRoom();
    const [a, c] = [thrower(), thrower()] as const;
    const b = target();
    throwsAt(c, b, 2);
    throwAt(a, b);
    expect(room.scoreList().find((s) => s.id === c.id)).toMatchObject({ kills: 0, assists: 1 });
    expect(room.scoreList().find((s) => s.id === a.id)).toMatchObject({ kills: 1, assists: 0 });
  });

  it('give no assist to the cook who landed the knockout, for the hits before it', () => {
    const { room, thrower, target, throwsAt } = knifeRoom();
    const a = thrower();
    const b = target();
    throwsAt(a, b, 3);
    expect(room.scoreList().find((s) => s.id === a.id)).toEqual({
      id: a.id,
      kills: 1,
      deaths: 0,
      assists: 0,
    });
  });

  it('share the assists among every cook who hit the victim', () => {
    const { room, thrower, target, throwAt } = knifeRoom();
    const [a, c, d] = [thrower(), thrower(), thrower()] as const;
    const b = target();
    throwAt(c, b);
    throwAt(d, b);
    throwAt(a, b);
    const scores = room.scoreList();
    expect(scores.find((s) => s.id === a.id)).toMatchObject({ kills: 1, assists: 0 });
    expect(scores.find((s) => s.id === c.id)).toMatchObject({ kills: 0, assists: 1 });
    expect(scores.find((s) => s.id === d.id)).toMatchObject({ kills: 0, assists: 1 });
  });

  it('only count the hits since the victim last got up', () => {
    const { room, thrower, target, throwAt, throwsAt, standUp } = knifeRoom();
    const [a, c] = [thrower(), thrower()] as const;
    const b = target();
    throwAt(c, b);
    throwsAt(a, b, 2);
    standUp(b);
    // C hit B in their last life, and was thanked for it then; B's next knockout owes C nothing.
    throwsAt(a, b, 3);
    const scores = room.scoreList();
    expect(scores.find((s) => s.id === a.id)).toMatchObject({ kills: 2 });
    expect(scores.find((s) => s.id === b.id)).toMatchObject({ deaths: 2 });
    expect(scores.find((s) => s.id === c.id)).toMatchObject({ assists: 1 });
  });

  it("credit an assist for a hit in the victim's new life, as in the first", () => {
    const { room, thrower, target, throwAt, throwsAt, standUp } = knifeRoom();
    const [a, c] = [thrower(), thrower()] as const;
    const b = target();
    throwsAt(a, b, 3);
    standUp(b);
    // C hits the new B once, then A knocks them out: C is credited for this life only.
    throwAt(c, b);
    throwsAt(a, b, 2);
    expect(room.scoreList().find((s) => s.id === c.id)).toMatchObject({ assists: 1 });
  });

  it('count a death and credit nobody with the kill, when the thrower has left the room', () => {
    const { room, thrower, target, throwAt, input, steps } = knifeRoom();
    const [a, c] = [thrower(), thrower()] as const;
    const b = target();
    throwAt(c, b);
    throwAt(a, b);
    // The knife that knocks B out is in the air as its thrower goes.
    const yaw = Math.atan2(a.state.x - b.state.x, a.state.z - b.state.z);
    for (let i = 0; i < KNIFE_COOLDOWN_INPUTS; i++) input(a, 0, yaw);
    input(a, Keys.Throw, yaw, -0.1);
    steps(KNIFE_COOLDOWN_INPUTS + 1);
    room.remove(a.id);
    steps(FLIGHT);
    expect(b.deadUntil).not.toBeNull();
    // B's death is counted, the other cook who hit them has their assist, the one who left has no row.
    expect(room.scoreList()).toEqual([
      { id: c.id, kills: 0, deaths: 0, assists: 1 },
      { id: b.id, kills: 0, deaths: 1, assists: 0 },
    ]);
  });

  it('give no assist to a cook who hit the victim and then left the room', () => {
    const { room, thrower, target, throwAt, throwsAt, received } = knifeRoom();
    const [a, c] = [thrower(), thrower()] as const;
    const b = target();
    throwAt(c, b);
    room.remove(c.id);
    throwsAt(a, b, 2);
    expect(room.scoreList().map((s) => s.id)).toEqual([a.id, b.id]);
    const [kill] = received(b.id, 'kill');
    expect(kill!.scores.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
  });

  it('are dropped with the cook who leaves, and a cook who comes back starts at nothing', () => {
    const { room, add, thrower, target, throwsAt } = knifeRoom();
    const a = thrower();
    const b = target();
    throwsAt(a, b, 3);
    room.remove(a.id);
    expect(room.scoreList()).toEqual([{ id: b.id, kills: 0, deaths: 1, assists: 0 }]);
    // The same visitor back in the room is a new cook, with a new place in it.
    const back = add(0, 5.6);
    expect(back.id).not.toBe(a.id);
    expect(room.scoreList().find((s) => s.id === back.id)).toEqual({
      id: back.id,
      kills: 0,
      deaths: 0,
      assists: 0,
    });
  });

  it("count Chef Skinner's knockouts as kills, like anyone's", () => {
    const { room, thrower, target, throwsAt } = knifeRoom();
    const chef = thrower({ resident: true });
    const victim = target();
    throwsAt(chef, victim, 3);
    expect(room.scoreList()).toEqual([
      { id: chef.id, kills: 1, deaths: 0, assists: 0 },
      { id: victim.id, kills: 0, deaths: 1, assists: 0 },
    ]);
  });

  it('count a death for Chef Skinner when a cook knocks him out', () => {
    const { room, thrower, add, throwsAt, received } = knifeRoom();
    const cook = thrower();
    const chef = add(0, 3.2, { resident: true });
    throwsAt(cook, chef, 3);
    expect(room.scoreList()).toEqual([
      { id: cook.id, kills: 1, deaths: 0, assists: 0 },
      { id: chef.id, kills: 0, deaths: 1, assists: 0 },
    ]);
    expect(received(cook.id, 'kill')[0]!.scores).toHaveLength(2);
  });

  it('give Chef Skinner an assist for a hit, like anyone', () => {
    const { room, thrower, target, throwAt, throwsAt } = knifeRoom();
    const chef = thrower({ resident: true });
    const a = thrower();
    const b = target();
    throwAt(chef, b);
    throwsAt(a, b, 2);
    expect(room.scoreList().find((s) => s.id === chef.id)).toMatchObject({ assists: 1 });
  });

  it('are kept apart from room to room', () => {
    const one = knifeRoom();
    const two = knifeRoom();
    const a = one.thrower();
    const b = one.target();
    two.thrower();
    two.target();
    one.throwsAt(a, b, 3);
    expect(one.room.scoreList().some((s) => s.kills > 0)).toBe(true);
    expect(two.room.scoreList().every((s) => s.kills + s.deaths + s.assists === 0)).toBe(true);
  });
});
