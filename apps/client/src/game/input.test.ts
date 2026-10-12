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
});

/** Stand-ins for the page's element classes, which `Input` asks of a key's target. */
class FakeTextField extends EventTarget {}

/** A key going down or up at `target` (the window, by default), cancelable as a browser's are. */
function key(
  type: 'keydown' | 'keyup',
  code: string,
  options: { repeat?: boolean; ctrl?: boolean; target?: EventTarget } = {},
): Event {
  const event = Object.assign(new Event(type, { cancelable: true }), {
    code,
    repeat: options.repeat ?? false,
    ctrlKey: options.ctrl ?? false,
    metaKey: false,
    altKey: false,
  });
  (options.target ?? window).dispatchEvent(event);
  return event;
}

describe('a key held to show something, Tab for the scoreboard', () => {
  beforeEach(() => {
    Object.assign(globalThis, {
      HTMLInputElement: FakeTextField,
      HTMLTextAreaElement: class {},
      HTMLElement: class {},
    });
  });

  afterEach(() => {
    for (const name of ['HTMLInputElement', 'HTMLTextAreaElement', 'HTMLElement']) {
      Reflect.deleteProperty(globalThis, name);
    }
  });

  /** A player with the key's presses and releases written down. */
  function holding() {
    const { input } = playing();
    const log: string[] = [];
    input.onHold = (code, down) => log.push(`${code} ${down ? 'down' : 'up'}`);
    return { input, log };
  }

  it('is told of the press and of the release, and keeps the browser from moving focus', () => {
    const { log } = holding();
    expect(key('keydown', 'Tab').defaultPrevented).toBe(true);
    expect(log).toEqual(['Tab down']);
    expect(key('keyup', 'Tab').defaultPrevented).toBe(false);
    expect(log).toEqual(['Tab down', 'Tab up']);
  });

  it('is told once however long it is held, and still keeps focus where it is on every repeat', () => {
    const { log } = holding();
    key('keydown', 'Tab');
    for (let i = 0; i < 5; i++) {
      expect(key('keydown', 'Tab', { repeat: true }).defaultPrevented).toBe(true);
    }
    expect(log).toEqual(['Tab down']);
  });

  it('does nothing while play is not on (a menu, the chat, the landing): Tab moves focus as usual', () => {
    const { input, log } = holding();
    input.enabled = false;
    expect(key('keydown', 'Tab').defaultPrevented).toBe(false);
    expect(key('keyup', 'Tab').defaultPrevented).toBe(false);
    expect(log).toEqual([]);
  });

  it('does nothing in a field being typed in, where Tab leaves it as usual', () => {
    const { log } = holding();
    expect(key('keydown', 'Tab', { target: new FakeTextField() }).defaultPrevented).toBe(false);
    expect(log).toEqual([]);
  });

  it("leaves the browser's own shortcut with Tab alone", () => {
    const { log } = holding();
    expect(key('keydown', 'Tab', { ctrl: true }).defaultPrevented).toBe(false);
    expect(log).toEqual([]);
  });

  it('lets go when the player is made to let go of everything: a menu, the chat, another window', () => {
    const { input, log } = holding();
    key('keydown', 'Tab');
    input.releaseAll();
    expect(log).toEqual(['Tab down', 'Tab up']);
    // The release that comes later, from a key the page no longer thinks held, says nothing more.
    key('keyup', 'Tab');
    expect(log).toEqual(['Tab down', 'Tab up']);
    // And it shows again on the next press.
    key('keydown', 'Tab');
    expect(log).toEqual(['Tab down', 'Tab up', 'Tab down']);
  });

  it('lets go when the window loses focus', () => {
    const { log } = holding();
    key('keydown', 'Tab');
    window.dispatchEvent(new Event('blur'));
    expect(log).toEqual(['Tab down', 'Tab up']);
  });

  it('is no movement key, and moves nobody', () => {
    const { input } = holding();
    key('keydown', 'Tab');
    key('keydown', 'KeyW');
    expect(input.keys).toBe(1);
    key('keyup', 'KeyW');
    expect(input.keys).toBe(0);
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
