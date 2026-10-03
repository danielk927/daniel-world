import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Input } from './input.ts';

/** Just enough of the page for Input: event targets for window, document and the canvas. */
class FakeDocument extends EventTarget {
  pointerLockElement: EventTarget | null = null;
  exitPointerLock(): void {
    this.setLock(null);
  }
  setLock(element: EventTarget | null): void {
    this.pointerLockElement = element;
    this.dispatchEvent(new Event('pointerlockchange'));
  }
}

let doc: FakeDocument;
let canvas: EventTarget & { requestPointerLock?: () => Promise<void> };
let lockRefused = false;

function mouse(target: EventTarget, type: string, button = 0): void {
  target.dispatchEvent(Object.assign(new Event(type), { button, movementX: 0, movementY: 0 }));
}

beforeEach(() => {
  doc = new FakeDocument();
  const win = Object.assign(new EventTarget(), { innerWidth: 960, innerHeight: 540 });
  Object.assign(globalThis, { window: win, document: doc });
  lockRefused = false;
  canvas = Object.assign(new EventTarget(), {
    requestPointerLock: () => {
      if (lockRefused) return Promise.reject(new Error('refused'));
      doc.setLock(canvas);
      return Promise.resolve();
    },
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'window');
  Reflect.deleteProperty(globalThis, 'document');
});

function playing(): { input: Input; presses: () => number } {
  const input = new Input(canvas as unknown as HTMLElement);
  input.enabled = true;
  let count = 0;
  input.onPrimary = () => count++;
  return { input, presses: () => count };
}

describe('the left button', () => {
  it('fires on the press while locked, and keeps firing while held', async () => {
    const { input, presses } = playing();
    await input.lock();
    mouse(canvas, 'mousedown');
    expect(presses()).toBe(1);
    expect(input.firing).toBe(true);
    mouse(window, 'mouseup');
    expect(input.firing).toBe(false);
  });

  it('only starts a look drag without pointer lock', () => {
    const { input, presses } = playing();
    mouse(canvas, 'mousedown');
    expect(presses()).toBe(0);
    expect(input.firing).toBe(false);
  });

  it('stops firing when the lock is lost or play pauses', async () => {
    const { input } = playing();
    await input.lock();
    mouse(canvas, 'mousedown');
    doc.exitPointerLock();
    expect(input.firing).toBe(false);

    await input.lock();
    mouse(canvas, 'mousedown');
    input.enabled = false;
    expect(input.firing).toBe(false);
  });

  it('ignores other buttons', async () => {
    const { input, presses } = playing();
    await input.lock();
    mouse(canvas, 'mousedown', 2);
    expect(presses()).toBe(0);
    expect(input.firing).toBe(false);
  });

  it('can be let go of until the next press, so a press that draws the knife does not throw it', async () => {
    const { input } = playing();
    await input.lock();
    mouse(canvas, 'mousedown');
    input.releasePrimary();
    expect(input.firing).toBe(false);
    mouse(canvas, 'mousedown');
    expect(input.firing).toBe(true);
  });
});

describe('pointer lock', () => {
  it('knows whether this browser has ever locked, so a refused relock is not mistaken for no lock', async () => {
    const { input } = playing();
    lockRefused = true;
    expect(await input.lock()).toBe(false);
    expect(input.lockWorks).toBe(false);
    lockRefused = false;
    expect(await input.lock()).toBe(true);
    doc.exitPointerLock();
    lockRefused = true;
    expect(await input.lock()).toBe(false);
    expect(input.lockWorks).toBe(true);
  });
});
