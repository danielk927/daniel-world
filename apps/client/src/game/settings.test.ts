import { describe, expect, it } from 'vitest';
import { defaultSettings, parseSettings } from './settings.ts';

describe('stored settings', () => {
  const defaults = defaultSettings(false);

  it('fall back to the defaults when nothing is stored', () => {
    expect(parseSettings(null, null, defaults)).toEqual(defaults);
  });

  it('keep what was saved', () => {
    const stored = JSON.stringify({
      fov: 90,
      invertY: true,
      quality: 'low',
      showFps: true,
      reduceMotion: true,
    });
    expect(parseSettings('2.5', stored, defaults)).toEqual({
      sensitivity: 2.5,
      fov: 90,
      invertY: true,
      quality: 'low',
      showFps: true,
      reduceMotion: true,
    });
  });

  it('clamp numbers into range and ignore anything of the wrong kind', () => {
    const stored = JSON.stringify({ fov: 400, invertY: 'yes', quality: 'ultra', showFps: 1 });
    expect(parseSettings('99', stored, defaults)).toEqual({
      ...defaults,
      sensitivity: 3,
      fov: 100,
    });
    expect(parseSettings('-1', '{not json', defaults)).toEqual(defaults);
    expect(parseSettings('0', '[1,2]', defaults)).toEqual(defaults);
  });

  it('start with reduced motion when the system asks for it', () => {
    expect(defaultSettings(true).reduceMotion).toBe(true);
  });
});
