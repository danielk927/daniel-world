import {
  COOLER_OPEN_DELAY_INPUTS,
  coolerBurst,
  type CoolerDent,
  type CoolerState,
} from '@world/shared';

/**
 * A room's walk-in door: every hit it has taken, and when it burst open. It lives as long as the
 * room does, so like the knives stuck about the kitchen it is whole again for the next visitors
 * once everyone has left.
 */
export class RoomCooler {
  private readonly dents: CoolerDent[] = [];
  /** The tick the door burst open, or null while it holds. */
  private burstTick: number | null = null;

  get hits(): number {
    return this.dents.length;
  }

  /** The door has given way; it never shuts again. */
  get burst(): boolean {
    return coolerBurst(this.dents.length);
  }

  /** Whether knives fly through the doorway at `tick`: once the swinging door has cleared it. */
  isOpenAt(tick: number): boolean {
    return this.burstTick !== null && tick >= this.burstTick + COOLER_OPEN_DELAY_INPUTS;
  }

  /** A hit at `tick`. False, and nothing changes, once the door is open: there is no door to hit. */
  hit(dent: CoolerDent, tick: number): boolean {
    if (this.burst) return false;
    this.dents.push({ z: dent.z, y: dent.y, by: dent.by });
    if (this.burst) this.burstTick = tick;
    return true;
  }

  /** The door as a newcomer's welcome describes it. */
  state(): CoolerState {
    return { dents: this.dents.map((dent) => ({ ...dent })) };
  }
}
