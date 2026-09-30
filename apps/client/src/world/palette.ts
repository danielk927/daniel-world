import { Color, Vector3 } from 'three';

/** Golden hour palette shared by sky, fog, lights and clouds so they always agree. */
export const palette = {
  zenith: new Color('#4f6fae'),
  horizon: new Color('#f7b99a'),
  horizonSun: new Color('#ffcf8a'),
  belowHorizon: new Color('#c9a0b8'),
  sun: new Color('#fff1d6'),
  fog: new Color('#eab39c'),
  sunLight: new Color('#ffcf9e'),
  hemiSky: new Color('#ffe1c7'),
  hemiGround: new Color('#6d5a7c'),
  cloudLit: new Color('#ffd9c2'),
  cloudShade: new Color('#a58bb5'),
} as const;

/** Direction toward the sun: low in the south-west, behind a player at spawn. */
export const SUN_DIRECTION = new Vector3(-0.55, 0.32, 0.77).normalize();
