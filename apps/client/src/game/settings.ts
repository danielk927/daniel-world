import type { Quality } from '../util/capabilities.ts';
import { storage } from '../util/storage.ts';

/** Graphics: chosen for the device (`auto`), or forced. */
export type QualityChoice = 'auto' | Quality;

export interface SettingsValues {
  /** Mouse look speed, as a multiple of the default. */
  sensitivity: number;
  /** Vertical field of view at rest, in degrees. */
  fov: number;
  /** Mouse up looks down, like a flight stick. */
  invertY: boolean;
  quality: QualityChoice;
  /** A frame rate readout in the corner. */
  showFps: boolean;
  /** No head bob, shake or screen effects that move. */
  reduceMotion: boolean;
}

export const SENSITIVITY_RANGE = [0.2, 3] as const;
export const FOV_RANGE = [60, 100] as const;

// Sensitivity keeps its original key, so visitors who set it before keep it.
const SENSITIVITY_KEY = 'world.sensitivity';
const SETTINGS_KEY = 'world.settings';

export function defaultSettings(prefersReducedMotion: boolean): SettingsValues {
  return {
    sensitivity: 1,
    fov: 72,
    invertY: false,
    quality: 'auto',
    showFps: false,
    reduceMotion: prefersReducedMotion,
  };
}

const clamp = (value: number, [min, max]: readonly [number, number]): number =>
  Math.min(max, Math.max(min, value));

/**
 * Stored settings over the defaults, keeping only values of the right kind and in range, so a
 * hand-edited or older store can never break the game.
 */
export function parseSettings(
  sensitivity: string | null,
  stored: string | null,
  defaults: SettingsValues,
): SettingsValues {
  const values = { ...defaults };
  const s = Number(sensitivity);
  if (sensitivity !== null && Number.isFinite(s) && s > 0) {
    values.sensitivity = clamp(s, SENSITIVITY_RANGE);
  }
  let raw: unknown;
  try {
    raw = stored ? JSON.parse(stored) : null;
  } catch {
    raw = null;
  }
  if (typeof raw !== 'object' || raw === null) return values;
  const r = raw as Record<string, unknown>;
  if (typeof r.fov === 'number' && Number.isFinite(r.fov)) values.fov = clamp(r.fov, FOV_RANGE);
  if (typeof r.invertY === 'boolean') values.invertY = r.invertY;
  if (r.quality === 'auto' || r.quality === 'high' || r.quality === 'low')
    values.quality = r.quality;
  if (typeof r.showFps === 'boolean') values.showFps = r.showFps;
  if (typeof r.reduceMotion === 'boolean') values.reduceMotion = r.reduceMotion;
  return values;
}

/** The player's settings: loaded once, saved on every change, and announced to whoever listens. */
export class Settings {
  private current: SettingsValues;
  private readonly listeners = new Set<(values: Readonly<SettingsValues>) => void>();

  private constructor(values: SettingsValues) {
    this.current = values;
  }

  static load(): Settings {
    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    return new Settings(
      parseSettings(
        storage.get(SENSITIVITY_KEY),
        storage.get(SETTINGS_KEY),
        defaultSettings(reduced),
      ),
    );
  }

  get values(): Readonly<SettingsValues> {
    return this.current;
  }

  set<K extends keyof SettingsValues>(key: K, value: SettingsValues[K]): void {
    if (this.current[key] === value) return;
    this.current = { ...this.current, [key]: value };
    const { sensitivity, ...rest } = this.current;
    storage.set(SENSITIVITY_KEY, String(sensitivity));
    storage.set(SETTINGS_KEY, JSON.stringify(rest));
    for (const listener of this.listeners) listener(this.current);
  }

  /** Called now with the current values, and again on every change. */
  subscribe(listener: (values: Readonly<SettingsValues>) => void): void {
    this.listeners.add(listener);
    listener(this.current);
  }
}
