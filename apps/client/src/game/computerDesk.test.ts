import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KitchenComputer } from '../computer/computer.ts';
import type { FromWorker } from '../computer/protocol.ts';
import type { ComputerScreen } from '../world/computer.ts';
import { ComputerDesk } from './computerDesk.ts';

/** Stands in for the machine's worker: takes what it is sent, replies on demand. */
class StubWorker {
  onmessage: ((event: MessageEvent<FromWorker>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  terminated = false;

  postMessage(): void {}

  terminate(): void {
    this.terminated = true;
  }

  reply(message: FromWorker): void {
    this.onmessage?.({ data: message } as MessageEvent<FromWorker>);
  }
}

describe('ComputerDesk', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { href: 'https://example.com/' });
    vi.stubGlobal('document', { hidden: false, addEventListener: vi.fn() });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('shows the standby screen and says so when DOOM crashes mid-game, and restarts it after', async () => {
    const workers: StubWorker[] = [];
    const showStandby = vi.fn();
    const screen = { showStandby, showFrame: vi.fn() } as unknown as ComputerScreen;
    const notify = vi.fn<(message: string) => void>();
    const desk = new ComputerDesk(screen, notify, () =>
      Promise.resolve(
        new KitchenComputer({
          createWorker: () => {
            const worker = new StubWorker();
            workers.push(worker);
            return worker as unknown as Worker;
          },
        }),
      ),
    );
    const sitting = desk.use();
    await vi.waitFor(() => expect(workers).toHaveLength(1));
    workers[0]!.reply({ type: 'running', engine: 'jit' });
    await sitting;
    expect(desk.state).toBe('running');

    // A guest fault in the middle of a game: the frozen frame gives way to the standby screen.
    workers[0]!.reply({ type: 'failed', message: 'illegal instruction' });
    expect(showStandby).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledOnce();
    expect(notify.mock.lastCall![0]).toMatch(/crashed/);

    // Sitting down again starts it afresh.
    desk.stepAway();
    const again = desk.use();
    await vi.waitFor(() => expect(workers).toHaveLength(2));
    workers[1]!.reply({ type: 'running', engine: 'jit' });
    await again;
    expect(desk.state).toBe('running');
    expect(notify).toHaveBeenCalledOnce();
  });
});
