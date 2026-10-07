import { describe, expect, it } from 'vitest';
import { encode, parseClientMessage, parseServerMessage, samePrefs } from './protocol.ts';
import {
  DEFAULT_LOOK,
  KNIFE_FINISHES,
  KNIFE_SKINS,
  SKIN_FINISHES,
  knifeLook,
  lookFields,
  lookKey,
} from './skins.ts';

describe('the knife catalogue', () => {
  it('starts with the chef’s knife as it comes', () => {
    expect(KNIFE_SKINS[0]).toBe('kitchen');
    expect(DEFAULT_LOOK).toEqual({ skin: 'kitchen', finish: SKIN_FINISHES.kitchen[0] });
  });

  it('gives every knife at least one known finish, each only once', () => {
    for (const skin of KNIFE_SKINS) {
      const finishes = SKIN_FINISHES[skin];
      expect(finishes.length).toBeGreaterThan(0);
      expect(new Set(finishes).size).toBe(finishes.length);
      for (const finish of finishes) expect(KNIFE_FINISHES).toContain(finish);
    }
  });

  it('uses every finish somewhere', () => {
    const used = new Set(KNIFE_SKINS.flatMap((skin) => SKIN_FINISHES[skin]));
    expect([...used].sort()).toEqual([...KNIFE_FINISHES].sort());
  });

  it('has a distinct key per look', () => {
    const keys = KNIFE_SKINS.flatMap((skin) =>
      SKIN_FINISHES[skin].map((finish) => lookKey({ skin, finish })),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('knifeLook', () => {
  it('keeps a knife in a finish it comes in', () => {
    expect(knifeLook('karambit', 'fade')).toEqual({ skin: 'karambit', finish: 'fade' });
  });

  it("gives a finish the knife does not come in as the knife's default", () => {
    expect(knifeLook('karambit', 'damascus')).toEqual({ skin: 'karambit', finish: 'doppler' });
    expect(knifeLook('karambit', undefined)).toEqual({ skin: 'karambit', finish: 'doppler' });
  });

  it('gives an unknown knife, or none, as the chef’s knife', () => {
    expect(knifeLook('lightsaber', 'fade')).toEqual(DEFAULT_LOOK);
    expect(knifeLook(undefined, undefined)).toEqual(DEFAULT_LOOK);
    expect(knifeLook(7, 'fade')).toEqual(DEFAULT_LOOK);
  });

  it('leaves the default out of messages, and names anything else', () => {
    expect(lookFields(DEFAULT_LOOK)).toEqual({});
    expect(lookFields({ skin: 'kitchen', finish: 'damascus' })).toEqual({
      skin: 'kitchen',
      finish: 'damascus',
    });
  });
});

describe('knife looks on the wire', () => {
  it('carry the knife a visitor chose in the hello and in a prefs message', () => {
    const prefs = { chef: true, skin: 'karambit', finish: 'doppler' };
    const hello = { t: 'hello', v: 7, name: 'Otter', room: 'lobby', prefs };
    expect(parseClientMessage(JSON.stringify(hello))).toEqual(hello);
    expect(parseClientMessage(JSON.stringify({ t: 'prefs', prefs }))).toEqual({
      t: 'prefs',
      prefs,
    });
  });

  it('leave prefs without a knife as they were', () => {
    expect(parseClientMessage('{"t":"prefs","prefs":{"chef":false}}')).toEqual({
      t: 'prefs',
      prefs: { chef: false },
    });
  });

  it.each([
    ['an unknown knife', { skin: 'lightsaber', finish: 'fade' }, { finish: 'fade' }],
    ['an unknown finish', { skin: 'karambit', finish: 'gold' }, { skin: 'karambit' }],
    ['a knife that is not a string', { skin: 3, finish: ['fade'] }, {}],
    ['a knife spelled in capitals', { skin: 'KARAMBIT', finish: 'Fade' }, {}],
  ])('drop %s, keeping the rest of the prefs', (_label, look, kept) => {
    const parsed = parseClientMessage(
      JSON.stringify({ t: 'prefs', prefs: { chef: true, ...look } }),
    );
    expect(parsed).toEqual({ t: 'prefs', prefs: { chef: true, ...kept } });
    // Whatever survives reads as a real look.
    if (parsed?.t !== 'prefs') throw new Error('expected prefs');
    const read = knifeLook(parsed.prefs.skin, parsed.prefs.finish);
    expect(KNIFE_SKINS).toContain(read.skin);
    expect(SKIN_FINISHES[read.skin]).toContain(read.finish);
  });

  it('still refuse prefs without the chef choice', () => {
    expect(parseClientMessage('{"t":"prefs","prefs":{"skin":"karambit"}}')).toBeNull();
  });

  it('tell prefs apart by the knife', () => {
    const karambit = { chef: true, skin: 'karambit', finish: 'fade' } as const;
    expect(samePrefs(karambit, { ...karambit })).toBe(true);
    expect(samePrefs(karambit, { ...karambit, finish: 'doppler' })).toBe(false);
    expect(samePrefs(karambit, { chef: true })).toBe(false);
  });

  it('carry the look on thrown and stuck knives, and in a welcome', () => {
    const look = { skin: 'butterfly', finish: 'web' } as const;
    const thrown = {
      t: 'knife',
      id: 3,
      from: 1,
      seq: 40,
      x: 0,
      y: 1.6,
      z: 5,
      vx: 0,
      vy: 0,
      vz: -18,
      ...look,
    } as const;
    expect(parseServerMessage(encode(thrown))).toEqual(thrown);
    const knife = { id: 3, x: 1, y: -0.04, z: 2, dx: 0, dy: -1, dz: 0, ...look };
    expect(parseServerMessage(encode({ t: 'stuck', knife, at: 0.3 }))).toEqual({
      t: 'stuck',
      knife,
      at: 0.3,
    });
    const self = {
      id: 1,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      yaw: 0,
      pitch: 0,
      grounded: true,
      dead: false,
      armed: true,
      ack: 0,
    };
    const welcome = {
      t: 'welcome',
      v: 7,
      id: 1,
      room: 'lobby',
      tick: 3,
      players: [],
      self,
      knives: [knife, { ...knife, id: 4, skin: undefined, finish: undefined }],
    };
    const parsed = parseServerMessage(encode(welcome as never));
    expect(parsed?.t === 'welcome' && parsed.knives.map((k) => k.skin)).toEqual([
      'butterfly',
      undefined,
    ]);
  });

  it('keep a knife whose look this version does not know, as the chef’s knife', () => {
    const knife = { id: 3, x: 1, y: -0.04, z: 2, dx: 0, dy: -1, dz: 0 };
    const parsed = parseServerMessage(
      JSON.stringify({ t: 'stuck', knife: { ...knife, skin: 'excalibur', finish: 7 }, at: 0.3 }),
    );
    expect(parsed).toEqual({ t: 'stuck', knife, at: 0.3 });
    if (parsed?.t !== 'stuck') throw new Error('expected stuck');
    expect(knifeLook(parsed.knife.skin, parsed.knife.finish)).toEqual(DEFAULT_LOOK);
  });
});
