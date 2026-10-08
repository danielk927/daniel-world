/**
 * Keeps the high tier inside the GPU's budget. A frame the GPU cannot finish in time does not just
 * lower the frame rate: the browser queues frames behind it, and every queued frame is another
 * frame of input lag on the mouse and the keys. So when frames fall behind the display's refresh,
 * the governor steps quality down, cheapest visual loss first, until they keep up.
 */

export interface RenderLevel {
  /** The most canvas pixels per CSS pixel; the screen's own ratio caps it lower. */
  readonly pixelRatio: number;
  /** Samples per pixel for antialiasing the scene. */
  readonly msaa: number;
  readonly ambientOcclusion: boolean;
}

/** Best first. A retina screen pays for every step; a 1x screen skips the resolution steps. */
export const RENDER_LEVELS: readonly RenderLevel[] = [
  { pixelRatio: 2, msaa: 4, ambientOcclusion: true },
  { pixelRatio: 1.5, msaa: 4, ambientOcclusion: true },
  { pixelRatio: 1.5, msaa: 0, ambientOcclusion: true },
  { pixelRatio: 1.25, msaa: 0, ambientOcclusion: true },
  { pixelRatio: 1, msaa: 0, ambientOcclusion: true },
  { pixelRatio: 1, msaa: 0, ambientOcclusion: false },
];

/** Frames per judgement. */
const WINDOW = 30;
/**
 * The slowest few frames of a window are left out, so a single hitch does not count. The rest are
 * averaged rather than taking the middle one: a GPU that misses one refresh in ten still has most
 * frames on time.
 */
const TRIM = 2;
/** A window this much slower than the display is falling behind (about 56 fps at 60 Hz). */
const BEHIND = 1.07;
/** A window this close to the display has headroom to spare. */
const EASY = 1.02;
/** Behind for this many windows in a row before stepping down (about half a second at 60 Hz). */
const BEHIND_WINDOWS = 2;
/** Easy for this long before trying one level up, in milliseconds. */
const UPGRADE_AFTER_MS = 25_000;
/** Longer than this, the tab was hidden or the page stalled; not a rendering problem. */
const PAUSE_MS = 250;

/**
 * 30 is not a display but a browser holding pages to it (Chrome's Energy Saver does, on a low
 * battery); 48 and 50 are rates a MacBook's display can be set to.
 */
const STANDARD_RATES = [30, 48, 50, 60, 75, 90, 100, 120, 144, 165, 240];

/**
 * The display's refresh interval from the shortest frame interval seen while rendering nothing,
 * snapped to a standard rate (frames can only arrive on a refresh, a little early or late).
 */
export function snapRefreshInterval(shortestMs: number): number {
  const hz = 1000 / shortestMs;
  if (!Number.isFinite(hz) || hz < 24) return 1000 / 60;
  let best = STANDARD_RATES[0]!;
  for (const rate of STANDARD_RATES) if (Math.abs(rate - hz) < Math.abs(best - hz)) best = rate;
  return 1000 / best;
}

export class QualityGovernor {
  level: number;
  private refreshMs: number;
  private readonly window = new Float32Array(WINDOW);
  private readonly sorted = new Float32Array(WINDOW);
  private filled = 0;
  private behindWindows = 0;
  private easyMs = 0;
  /** The next window comes right after a change; it judges the old settings, so skip it. */
  private settling = false;
  /** The best level that has fallen behind this session; never climb back to it or past it. */
  private tooHeavy = -1;
  /** Just tried a level up: one window behind is enough to step straight back. */
  private trial = false;

  constructor(refreshMs: number, startLevel: number) {
    this.refreshMs = refreshMs;
    this.level = Math.max(0, Math.min(RENDER_LEVELS.length - 1, startLevel));
  }

  /** Feed one frame's interval. Returns the new level when it changes, otherwise null. */
  frame(ms: number): number | null {
    if (ms >= PAUSE_MS || ms <= 0) return null;
    this.window[this.filled++] = ms;
    if (this.filled < WINDOW) return null;
    this.filled = 0;
    if (this.settling) {
      this.settling = false;
      return null;
    }
    this.sorted.set(this.window);
    this.sorted.sort();
    // Frames cannot come faster than the display refreshes, so a window with more than a few of
    // them quicker than the refresh measured while loading shows a faster one: the browser stopped
    // capping the frame rate (the laptop was plugged in), or the window moved to a faster screen.
    // A slower cadence cannot be told from a GPU falling behind, so the refresh only ever speeds up.
    const quick = this.sorted[TRIM]!;
    const shown = quick < this.refreshMs * 0.8 ? snapRefreshInterval(quick) : this.refreshMs;
    if (shown < this.refreshMs) {
      this.refreshMs = shown;
      // Easy against the old refresh says nothing about the new one.
      this.easyMs = 0;
    }
    let sum = 0;
    for (let i = 0; i < WINDOW - TRIM; i++) sum += this.sorted[i]!;
    const typical = sum / (WINDOW - TRIM);

    if (typical > this.refreshMs * BEHIND) {
      this.easyMs = 0;
      if (++this.behindWindows < BEHIND_WINDOWS && !this.trial) return null;
      this.behindWindows = 0;
      this.trial = false;
      this.tooHeavy = Math.max(this.tooHeavy, this.level);
      return this.change(this.level + 1);
    }
    this.behindWindows = 0;
    if (typical <= this.refreshMs * EASY) this.easyMs += typical * WINDOW;
    else this.easyMs = 0;
    // A level up has held long enough to count.
    if (this.trial && this.easyMs > 3000) this.trial = false;
    if (this.easyMs >= UPGRADE_AFTER_MS && this.level - 1 > this.tooHeavy) {
      this.easyMs = 0;
      this.trial = true;
      return this.change(this.level - 1);
    }
    return null;
  }

  private change(level: number): number | null {
    const next = Math.max(0, Math.min(RENDER_LEVELS.length - 1, level));
    if (next === this.level) return null;
    this.level = next;
    this.settling = true;
    return next;
  }
}
