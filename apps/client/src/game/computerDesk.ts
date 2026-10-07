import type { Ray } from 'three';
import { COMPUTER } from '@world/shared';
import type { KitchenComputer } from '../computer/computer.ts';
import type { ComputerScreen } from '../world/computer.ts';

/**
 * The kitchen computer as the game uses it: picked by the crosshair like a station, switched on the
 * first time a cook sits down at it, and paused whenever nobody is using it (or the tab is hidden),
 * so it costs nothing then. The machine and DOOM's 4 MB WAD load only on first use.
 */
export class ComputerDesk {
  private machine: KitchenComputer | null = null;
  private loading: Promise<KitchenComputer> | null = null;
  private readonly screen: ComputerScreen;
  private readonly notify: (message: string) => void;
  private inUse = false;
  /** Frames shown so far, for debugging and tests. */
  frames = 0;

  constructor(screen: ComputerScreen, notify: (message: string) => void) {
    this.screen = screen;
    this.notify = notify;
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.machine?.pause();
      else if (this.inUse) void this.machine?.powerOn().catch(() => {});
    });
  }

  /** The machine's state: 'off' until first used. */
  get state(): string {
    return this.machine?.state ?? 'off';
  }

  /** Whether `ray` points at the screen from within `reach` meters. */
  picked(ray: Ray, reach: number): boolean {
    const dx = COMPUTER.x - ray.origin.x;
    const dy = COMPUTER.y - ray.origin.y;
    const dz = COMPUTER.z - ray.origin.z;
    const d = ray.direction;
    const along = dx * d.x + dy * d.y + dz * d.z;
    if (along < 0 || along > reach) return false;
    const ax = dx - d.x * along;
    const ay = dy - d.y * along;
    const az = dz - d.z * along;
    return ax * ax + ay * ay + az * az < COMPUTER.radius * COMPUTER.radius;
  }

  /** Sit down at it: boots DOOM the first time, carries on where it was after that. */
  async use(): Promise<void> {
    this.inUse = true;
    try {
      const machine = await this.load();
      if (!this.inUse) return;
      await machine.powerOn();
    } catch {
      this.screen.showStandby();
      this.notify('The kitchen computer would not start. Try again in a moment.');
      this.loading = null;
      this.machine?.dispose();
      this.machine = null;
    }
  }

  /** Step away: the game pauses where it is, still on the screen. */
  stepAway(): void {
    this.inUse = false;
    this.machine?.pause();
  }

  /** Mouse motion, as MouseEvent.movementX: turns the marine. */
  mouseMove(dx: number): void {
    this.machine?.mouseMove(dx);
  }

  /** A mouse button, as MouseEvent.button: the left one fires. */
  mouseButton(button: number, down: boolean): void {
    this.machine?.mouseButton(button, down);
  }

  /** A key from the cook at the keyboard, as a KeyboardEvent code. */
  key(code: string, down: boolean): void {
    this.machine?.key(code, down);
  }

  private load(): Promise<KitchenComputer> {
    this.loading ??= import('../computer/computer.ts').then(({ KitchenComputer }) => {
      const machine = new KitchenComputer();
      machine.onFrame((frame) => {
        this.frames++;
        this.screen.showFrame(frame.pixels);
      });
      this.machine = machine;
      return machine;
    });
    return this.loading;
  }
}
