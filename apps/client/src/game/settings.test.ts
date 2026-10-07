import { afterEach, describe, expect, it, vi } from 'vitest';
import { Settings, defaultSettings, parseSettings } from './settings.ts';

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
      chefThrows: false,
    });
    expect(parseSettings('2.5', stored, defaults)).toEqual({
      sensitivity: 2.5,
      fov: 90,
      invertY: true,
      quality: 'low',
      showFps: true,
      reduceMotion: true,
      chefThrows: false,
    });
  });

  it('clamp numbers into range and ignore anything of the wrong kind', () => {
    const stored = JSON.stringify({
      fov: 400,
      invertY: 'yes',
      quality: 'ultra',
      showFps: 1,
      chefThrows: 'no',
    });
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

  it('let Chef Skinner throw at a newcomer, and a store from before the choice existed', () => {
    expect(defaults.chefThrows).toBe(true);
    expect(parseSettings(null, JSON.stringify({ fov: 80 }), defaults).chefThrows).toBe(true);
  });
});

describe('settings across a reload', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('come back as they were left, and tell listeners of each change', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    const settings = Settings.load();
    const heard: boolean[] = [];
    settings.subscribe((values) => heard.push(values.chefThrows));
    settings.set('chefThrows', false);
    // The same value again is not news.
    settings.set('chefThrows', false);
    expect(heard).toEqual([true, false]);
    expect(Settings.load().values.chefThrows).toBe(false);
    settings.set('chefThrows', true);
    expect(Settings.load().values.chefThrows).toBe(true);
  });
});
