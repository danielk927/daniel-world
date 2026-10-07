import {
  COOLER_OPEN_DELAY_INPUTS,
  EYE_HEIGHT,
  coolerBurst,
  knifeInCoolerDoor,
  punchOnCoolerDoor,
  type CoolerDent,
  type CoolerHitMessage,
  type PlayerState,
  type StuckKnife,
} from '@world/shared';
import type { CoolerDoor } from '../world/cooler.ts';
import type { LocalPlayer } from './localPlayer.ts';

/**
 * The walk-in's door, from this player's side: which hits the room has decided (the server's word
 * online; this screen's own, playing solo), when each one shows (as the fist or knife that made it
 * arrives on screen), and from which input this player's movement sees the doorway open.
 */
export class CoolerControl {
  private readonly door: CoolerDoor;
  private readonly player: LocalPlayer;
  /** Told when this player's own fist meets the door. */
  private readonly onFistLands: () => void;
  /** Hits the room has decided, oldest first. */
  private readonly decided: CoolerDent[] = [];
  /** Decided hits waiting for what made them to arrive on screen, in order. */
  private readonly due: { at: number; dent: CoolerDent }[] = [];
  /** World time this player's own punch lands, while it is on its way to the door. */
  private fistAt: number | null = null;

  constructor(door: CoolerDoor, player: LocalPlayer, onFistLands: () => void) {
    this.door = door;
    this.player = player;
    this.onFistLands = onFistLands;
  }

  /** Hits the room has decided on, whether or not they show yet. */
  get hits(): number {
    return this.decided.length;
  }

  /** The room has decided the door is open. */
  get open(): boolean {
    return coolerBurst(this.decided.length);
  }

  /** Start over with this door, shown at once: a welcome, another room, a fresh visit. */
  reset(dents: readonly CoolerDent[]): void {
    this.decided.length = 0;
    this.decided.push(...dents);
    this.due.length = 0;
    this.fistAt = null;
    this.door.reset(dents);
    // Already open: open for every input; the door is not swinging anywhere.
    this.player.coolerOpenFrom = this.open ? 0 : Infinity;
  }

  /**
   * The server says the door was hit; it shows `wait` seconds from `now`, as what hit it arrives on
   * this screen. This player's own punch shows no sooner than their fist gets there.
   */
  serverHit(message: CoolerHitMessage, now: number, wait: number, own: boolean): void {
    if (this.open) return;
    this.decided.push(message.dent);
    if (message.openFrom !== undefined) this.player.coolerOpenFrom = message.openFrom;
    let at = now + wait;
    if (own && message.dent.by === 'fist' && this.fistAt !== null) at = Math.max(at, this.fistAt);
    this.due.push({ at, dent: message.dent });
  }

  /**
   * This player punched, from `state` as predicted after that input's step; the fist lands at
   * `landsAt`. Solo, a punch on the door is a hit; online, the server decides and says so.
   */
  punched(state: PlayerState, landsAt: number, solo: boolean): void {
    if (this.open) return;
    const on = punchOnCoolerDoor(state.x, state.y + EYE_HEIGHT, state.z, state.yaw, state.pitch);
    if (!on) return;
    this.fistAt = landsAt;
    if (solo) this.decide({ ...on, by: 'fist' }, landsAt);
  }

  /** A knife this screen flew, with nobody else to decide, stuck: in the door, it is a hit. */
  knifeStuck(knife: StuckKnife, now: number): void {
    if (this.open) return;
    const on = knifeInCoolerDoor(knife.x, knife.y, knife.z);
    if (on) this.decide({ ...on, by: 'knife' }, now);
  }

  /** A hit decided on this screen: the burst opens the doorway a little ahead, as the server would. */
  private decide(dent: CoolerDent, at: number): void {
    this.decided.push(dent);
    if (this.open) this.player.coolerOpenFrom = this.player.nextSeq + COOLER_OPEN_DELAY_INPUTS;
    this.due.push({ at, dent });
  }

  /** Per frame: show the hits whose fist or knife has arrived. */
  update(now: number): void {
    if (this.fistAt !== null && now >= this.fistAt) {
      this.fistAt = null;
      this.onFistLands();
    }
    while (this.due.length > 0 && now >= this.due[0]!.at) {
      this.door.hit(this.due.shift()!.dent, now);
    }
  }
}
