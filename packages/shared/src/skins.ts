/**
 * Knife skins: which knives a cook can carry and the finishes each comes in. Only the ids live
 * here, since the room server relays them and every screen must agree on what they mean; the
 * models, paints and animations are the client's.
 */

/** Every knife, the kitchen's own chef's knife first: it is what a cook carries until they choose. */
export const KNIFE_SKINS = [
  'kitchen',
  'karambit',
  'butterfly',
  'm9',
  'bayonet',
  'flip',
  'huntsman',
  'falchion',
  'gut',
  'talon',
  'skeleton',
  'stiletto',
] as const;

export type KnifeSkin = (typeof KNIFE_SKINS)[number];

/** Every finish a knife can come in. Which knife has which is `SKIN_FINISHES`. */
export const KNIFE_FINISHES = [
  'stock',
  'damascus',
  'doppler',
  'fade',
  'marble',
  'tiger',
  'web',
  'case',
  'slaughter',
  'vanilla',
] as const;

export type KnifeFinish = (typeof KNIFE_FINISHES)[number];

/** The finishes each knife comes in, its signature finish first; the first is its default. */
export const SKIN_FINISHES: Readonly<Record<KnifeSkin, readonly KnifeFinish[]>> = {
  kitchen: ['stock', 'damascus'],
  karambit: ['doppler', 'fade', 'vanilla'],
  butterfly: ['fade', 'web', 'vanilla'],
  m9: ['doppler', 'tiger', 'vanilla'],
  bayonet: ['marble', 'case', 'vanilla'],
  flip: ['doppler', 'case', 'vanilla'],
  huntsman: ['tiger', 'web', 'vanilla'],
  falchion: ['fade', 'slaughter', 'vanilla'],
  gut: ['doppler', 'case', 'vanilla'],
  talon: ['marble', 'slaughter', 'vanilla'],
  skeleton: ['fade', 'web', 'vanilla'],
  stiletto: ['marble', 'tiger', 'vanilla'],
};

/** How a knife looks: which knife, in which finish. */
export interface KnifeLook {
  readonly skin: KnifeSkin;
  readonly finish: KnifeFinish;
}

/** The kitchen's chef's knife, as it comes. */
export const DEFAULT_LOOK: KnifeLook = { skin: 'kitchen', finish: 'stock' };

export function isKnifeSkin(value: unknown): value is KnifeSkin {
  return typeof value === 'string' && (KNIFE_SKINS as readonly string[]).includes(value);
}

export function isKnifeFinish(value: unknown): value is KnifeFinish {
  return typeof value === 'string' && (KNIFE_FINISHES as readonly string[]).includes(value);
}

/**
 * The look a skin and finish name, whatever they are: an unknown knife is the chef's knife, and a
 * finish the knife does not come in is its default. Everything that draws a knife goes through
 * this, so a newer client's knife, or a hand-edited one, can never break anyone's screen.
 */
export function knifeLook(skin: unknown, finish: unknown): KnifeLook {
  if (!isKnifeSkin(skin)) return DEFAULT_LOOK;
  const finishes = SKIN_FINISHES[skin];
  return {
    skin,
    finish: isKnifeFinish(finish) && finishes.includes(finish) ? finish : finishes[0]!,
  };
}

/** One string per look, for maps and sets. */
export function lookKey(look: KnifeLook): string {
  return `${look.skin}/${look.finish}`;
}

export function sameLook(a: KnifeLook, b: KnifeLook): boolean {
  return a.skin === b.skin && a.finish === b.finish;
}

/**
 * A look as optional message fields: nothing for the chef's knife as it comes, so messages about
 * the default knife are exactly as they were before skins.
 */
export function lookFields(look: KnifeLook): { skin?: KnifeSkin; finish?: KnifeFinish } {
  return sameLook(look, DEFAULT_LOOK) ? {} : { skin: look.skin, finish: look.finish };
}
