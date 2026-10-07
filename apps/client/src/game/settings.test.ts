import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_LOOK } from '@world/shared';
import { Settings, defaultSettings, parseSettings, prefsOf } from './settings.ts';

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
      knife: { skin: 'butterfly', finish: 'web' },
    });
    expect(parseSettings('2.5', stored, defaults)).toEqual({
      sensitivity: 2.5,
      fov: 90,
      invertY: true,
      quality: 'low',
      showFps: true,
      reduceMotion: true,
      chefThrows: false,
      knife: { skin: 'butterfly', finish: 'web' },
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

  it('give a newcomer, and a store from before knives could be chosen, the chef’s knife', () => {
    expect(defaults.knife).toEqual(DEFAULT_LOOK);
    expect(parseSettings(null, JSON.stringify({ fov: 80 }), defaults).knife).toEqual(DEFAULT_LOOK);
  });

  it('never keep a knife or finish that does not exist', () => {
    const parse = (knife: unknown) =>
      parseSettings(null, JSON.stringify({ knife }), defaults).knife;
    expect(parse({ skin: 'lightsaber', finish: 'fade' })).toEqual(DEFAULT_LOOK);
    expect(parse('karambit')).toEqual(DEFAULT_LOOK);
    expect(parse(null)).toEqual(DEFAULT_LOOK);
    // A knife in a finish it does not come in wears its own first finish.
    expect(parse({ skin: 'karambit', finish: 'web' })).toEqual({
      skin: 'karambit',
      finish: 'doppler',
    });
  });

  it('tell the room the knife only when it is not the chef’s knife as it comes', () => {
    expect(prefsOf(defaults)).toEqual({ chef: true });
    expect(prefsOf({ ...defaults, knife: { skin: 'gut', finish: 'case' } })).toEqual({
      chef: true,
      skin: 'gut',
      finish: 'case',
    });
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

  it('keep the equipped knife across a reload', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    const settings = Settings.load();
    expect(settings.values.knife).toEqual(DEFAULT_LOOK);
    settings.set('knife', { skin: 'karambit', finish: 'fade' });
    expect(Settings.load().values.knife).toEqual({ skin: 'karambit', finish: 'fade' });
    // The other settings are untouched by it.
    expect(Settings.load().values.chefThrows).toBe(true);
  });
});
