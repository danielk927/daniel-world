import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KitchenComputer, MOUSE_COUNTS_PER_PIXEL } from './computer.ts';
import type { FromWorker, ToWorker } from './protocol.ts';

/** Stands in for the machine's worker: records what it is sent, replies on demand. */
class FakeWorker {
  readonly sent: { message: ToWorker; transfer: Transferable[] }[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: ToWorker, transfer: Transferable[] = []): void {
    // A real postMessage copies everything it does not transfer.
    const copy = message instanceof Uint8ClampedArray ? message : structuredClone(message);
    this.sent.push({ message: copy, transfer });
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(message: FromWorker): void {
    this.onmessage?.({ data: message } as MessageEvent<FromWorker>);
  }

  /** Messages other than returned frame buffers. */
  get messages(): ToWorker[] {
    return this.sent.map((s) => s.message).filter((m) => !(m instanceof Uint8ClampedArray));
  }
}

describe('KitchenComputer', () => {
  let workers: FakeWorker[];
  let computer: KitchenComputer;

  beforeEach(() => {
    vi.stubGlobal('location', { href: 'https://example.com/kitchen/' });
    workers = [];
    computer = new KitchenComputer({
      createWorker: () => {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker as unknown as Worker;
      },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const boot = async () => {
    const on = computer.powerOn();
    workers.at(-1)!.reply({ type: 'running', engine: 'jit' });
    await on;
    return workers.at(-1)!;
  };

  it('does nothing until it is switched on, then boots the worker with the assets', async () => {
    expect(computer.state).toBe('off');
    expect(workers).toHaveLength(0);
    const on = computer.powerOn();
    expect(computer.state).toBe('booting');
    const [message] = workers[0]!.messages;
    expect(message).toMatchObject({ type: 'boot', args: '' });
    const { programUrl, diskUrl } = message as { programUrl: string; diskUrl: string };
    expect(programUrl).toMatch(/^https:\/\/example\.com\/.*doom\.elf$/);
    expect(diskUrl).toMatch(/^https:\/\/example\.com\/.*doom1\.wad$/);
    workers[0]!.reply({ type: 'running', engine: 'jit' });
    await on;
    expect(computer.state).toBe('running');
    expect(computer.engine).toBe('jit');
  });

  it('copies each frame into the screen and hands the buffer straight back', async () => {
    const worker = await boot();
    const frames: Uint8ClampedArray[] = [];
    computer.onFrame((screen) => frames.push(screen.pixels));
    const frame = new Uint8ClampedArray(320 * 200 * 4).fill(7);
    worker.reply(frame);
    expect(frames).toEqual([computer.screen.pixels]);
    expect(computer.screen.pixels[123]).toBe(7);
    const returned = worker.sent.at(-1)!;
    expect(returned.message).toBe(frame);
    expect(returned.transfer).toEqual([frame.buffer]);
  });

  it('maps keys, drops auto-repeat and merges keys that mean the same', async () => {
    const worker = await boot();
    computer.key('KeyW', true);
    computer.key('KeyW', true);
    computer.key('ArrowUp', true);
    computer.key('KeyW', false);
    computer.key('ArrowUp', false);
    computer.key('ArrowUp', false);
    computer.key('MediaPlayPause', true);
    expect(worker.messages.slice(1)).toEqual([
      { type: 'key', key: 0xad, typed: 'w'.charCodeAt(0), down: true },
      { type: 'key', key: 0xad, typed: 0, down: false },
    ]);
  });

  it('pauses with every key released, and resumes', async () => {
    const worker = await boot();
    computer.key('Space', true);
    computer.pause();
    expect(computer.state).toBe('paused');
    expect(worker.messages.slice(1)).toEqual([
      { type: 'key', key: 0xa2, typed: 32, down: true },
      { type: 'key', key: 0xa2, typed: 32, down: false },
      { type: 'pause' },
    ]);
    computer.key('Space', true);
    await computer.powerOn();
    expect(computer.state).toBe('running');
    expect(worker.messages.at(-1)).toEqual({ type: 'run' });
    expect(workers).toHaveLength(1);
  });

  describe('the mouse', () => {
    let frames: (() => void)[];
    const nextFrame = () => {
      const callbacks = frames;
      frames = [];
      for (const callback of callbacks) callback();
    };
    beforeEach(() => {
      frames = [];
      vi.stubGlobal('requestAnimationFrame', (callback: () => void) => frames.push(callback));
    });
    const mouseMessages = (worker: FakeWorker) =>
      worker.messages.filter((m) => !(m instanceof Uint8ClampedArray) && m.type === 'mouse');

    it('adds up motion and sends it once a frame, in counts, fractions carried over', async () => {
      const worker = await boot();
      for (let k = 0; k < 10; k++) computer.mouseMove(1);
      computer.mouseMove(-0.5);
      expect(frames).toHaveLength(1);
      expect(mouseMessages(worker)).toEqual([]);
      nextFrame();
      // 9.5 pixels is 27.25 counts: 27 now, the quarter kept for later.
      expect(MOUSE_COUNTS_PER_PIXEL * 9.5).toBeCloseTo(27.25, 1);
      expect(mouseMessages(worker)).toEqual([{ type: 'mouse', dx: 27, buttons: 0 }]);
      computer.mouseMove(0.3);
      nextFrame();
      expect(mouseMessages(worker).at(-1)).toEqual({ type: 'mouse', dx: 1, buttons: 0 });
      // Nothing moved, nothing sent.
      computer.mouseMove(0);
      nextFrame();
      expect(mouseMessages(worker)).toHaveLength(2);
    });

    it('turns half a turn for 1428 pixels, as the kitchen does at sensitivity 1', () => {
      expect(Math.round(4096 / MOUSE_COUNTS_PER_PIXEL)).toBe(1428);
    });

    it('sends the left button at once, with the motion so far, and ignores the others', async () => {
      const worker = await boot();
      computer.mouseMove(-10);
      computer.mouseButton(0, true);
      computer.mouseButton(0, true);
      computer.mouseButton(2, true);
      computer.mouseButton(0, false);
      nextFrame();
      expect(mouseMessages(worker)).toEqual([
        { type: 'mouse', dx: -28, buttons: 1 },
        { type: 'mouse', dx: 0, buttons: 0 },
      ]);
    });

    it('does nothing unless the machine runs, and pauses with the button released', async () => {
      computer.mouseMove(50);
      computer.mouseButton(0, true);
      expect(frames).toHaveLength(0);
      const worker = await boot();
      computer.mouseButton(0, true);
      computer.mouseMove(2);
      computer.pause();
      expect(worker.messages.slice(1)).toEqual([
        { type: 'mouse', dx: 0, buttons: 1 },
        { type: 'mouse', dx: 5, buttons: 0 },
        { type: 'pause' },
      ]);
      computer.mouseMove(100);
      computer.mouseButton(0, false);
      nextFrame();
      expect(worker.messages).toHaveLength(4);
      // A machine booted afresh starts with nothing held.
      computer.mouseButton(0, true);
      computer.dispose();
      const next = await boot();
      computer.mouseButton(0, true);
      expect(mouseMessages(next)).toEqual([{ type: 'mouse', dx: 0, buttons: 1 }]);
    });
  });

  it('honours a pause that comes while it boots', async () => {
    const on = computer.powerOn();
    computer.pause();
    workers[0]!.reply({ type: 'running', engine: 'interpreter' });
    await on;
    expect(computer.state).toBe('paused');
    expect(workers[0]!.messages.at(-1)).toEqual({ type: 'pause' });
  });

  it('forgets a pause from a boot that failed', async () => {
    const on = computer.powerOn();
    computer.pause();
    workers[0]!.reply({ type: 'failed', message: 'no network' });
    await expect(on).rejects.toThrow('no network');
    await boot();
    expect(computer.state).toBe('running');
  });

  it('ignores what a replaced worker still had to say', async () => {
    const first = await boot();
    computer.dispose();
    const on = computer.powerOn();
    first.reply({ type: 'failed', message: 'stale' });
    workers[1]!.reply({ type: 'running', engine: 'jit' });
    await on;
    expect(computer.state).toBe('running');
    expect(computer.error).toBe(null);
  });

  it('reports a failure and boots afresh on the next power on', async () => {
    const on = computer.powerOn();
    workers[0]!.reply({ type: 'failed', message: 'illegal instruction' });
    await expect(on).rejects.toThrow('illegal instruction');
    expect(computer.state).toBe('failed');
    expect(computer.error).toBe('illegal instruction');
    expect(workers[0]!.terminated).toBe(true);
    await boot();
    expect(workers).toHaveLength(2);
    expect(computer.state).toBe('running');
    expect(computer.error).toBe(null);
  });

  it('forwards the console and shuts down on dispose', async () => {
    const worker = await boot();
    const lines: string[] = [];
    computer.onConsole((line) => lines.push(line));
    worker.reply({ type: 'console', line: 'W_Init: Init WADfiles.' });
    expect(lines).toEqual(['W_Init: Init WADfiles.']);
    computer.dispose();
    expect(worker.terminated).toBe(true);
    expect(computer.state).toBe('off');
  });
});
