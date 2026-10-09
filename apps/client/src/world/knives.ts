import { Matrix4, Quaternion, Vector3, type Group } from 'three';
import {
  DEFAULT_LOOK,
  KNIFE_MAX_FLIGHT_SECONDS,
  KNIFE_MAX_STUCK,
  KNIFE_SPIN,
  flyKnife,
  knifeLook,
  lookFields,
  type KnifeImpact,
  type KnifeLook,
  type KnifeState,
  type KnifeTarget,
  type StuckKnife,
} from '@world/shared';
import { KnifeBatches } from './knifeBatches.ts';
import { knifeCenter } from './knifeModel.ts';

/** More knives than this in the air at once are not drawn (16 players at full rate is ~23). */
const MAX_FLYING = 32;
/** World knives are drawn larger than life, so one stuck across the room still reads as a knife. */
const SCALE = 1.5;
/** Own throws start at the hand on screen and blend onto their true path this fast, in seconds. */
const HAND_BLEND = 0.12;
/** A knife that landed on this screen waits this long for the server's verdict, then settles. */
const VERDICT_TIMEOUT = 2;

type Outcome =
  | { readonly kind: 'stuck'; readonly knife: StuckKnife; readonly at: number }
  | { readonly kind: 'kill'; readonly at: number };

interface Flight {
  /** The server's id, once known. Own throws learn theirs when the server echoes them. */
  id: number | null;
  /** The input that threw it, for this player's own throws; -1 otherwise. */
  readonly seq: number;
  readonly from: number;
  readonly state: KnifeState;
  /** Seconds into the flight as drawn. Negative while it waits to leave a remote thrower's hand. */
  clock: number;
  /** Whether the server decides how it ends. Offline throws end where this screen says. */
  online: boolean;
  /** The server's verdict, applied once the drawn flight gets that far. */
  outcome: Outcome | null;
  /** Where the replay on this screen hit something, if it has. */
  landed: KnifeImpact | null;
  /** Seconds spent landed, waiting for the verdict. */
  waited: number;
  /** Where it is drawn, relative to where it flies, at release; fades to nothing over HAND_BLEND. */
  readonly ox: number;
  readonly oy: number;
  readonly oz: number;
  /** The knife as its thrower carried it. */
  readonly look: KnifeLook;
}

const FORWARD = new Vector3(0, 0, -1);

/** Whether a knife thrown by `from` passes through `to`. */
export type Spares = (from: number, to: number) => boolean;

/** Something that moves with the knives stuck in it: the walk-in's door, as it swings open. */
export interface KnifeCarrier {
  /** Whether a knife stuck with its tip here is in it. */
  carries(x: number, y: number, z: number): boolean;
  /** Where it has carried its knives from where they stuck. */
  readonly motion: Matrix4;
}

/**
 * Every knife in the world: stuck in the kitchen or flying. Flights are replayed with the shared
 * simulation and end where the server says, when the drawn flight reaches that moment, so a hit
 * looks like a hit on every screen. Each knife is the one its thrower carried, and they are drawn
 * as one instanced mesh per look (knifeBatches.ts).
 */
export class Knives {
  private readonly batches = new KnifeBatches(KNIFE_MAX_STUCK + MAX_FLYING);
  readonly group: Group = this.batches.group;
  private readonly flights: Flight[] = [];
  private readonly stuck: StuckKnife[] = [];
  /** Each stuck knife's look, in step with `stuck`. */
  private readonly stuckLooks: KnifeLook[] = [];
  private readonly stuckMatrices: Matrix4[] = Array.from(
    { length: KNIFE_MAX_STUCK },
    () => new Matrix4(),
  );
  private nextLocalId = -1;
  private dirty = true;
  /** What carries knives stuck in it, and which stuck knives it carries (one flag per knife). */
  private carrier: KnifeCarrier | null = null;
  private readonly carried: boolean[] = [];
  /** The walk-in's doorway lets knives through, as far as this screen knows. */
  coolerOpen = false;
  /** A knife this screen flew, with nobody else to decide, stuck where it landed. */
  onOfflineStuck: ((knife: StuckKnife) => void) | null = null;
  /**
   * Farthest the server's word has moved a knife from where this screen flew it to stick, in
   * meters: about 0 while every flight leaves the hand as the server's did. For debugging and
   * tests.
   */
  maxCorrection = 0;

  // Scratch, so updates never allocate.
  private readonly m = new Matrix4();
  private readonly offset = new Matrix4();
  private readonly q = new Quaternion();
  private readonly spin = new Quaternion();
  private readonly v = new Vector3();
  private readonly p = new Vector3();
  private readonly scale = new Vector3(SCALE, SCALE, SCALE);
  private readonly xAxis = new Vector3(1, 0, 0);
  private readonly someTargets: KnifeTarget[] = [];

  get stuckCount(): number {
    return this.stuck.length;
  }

  /** The knives stuck around the room, oldest first. */
  stuckKnives(): readonly StuckKnife[] {
    return this.stuck;
  }

  /** Knives stuck in `carrier` move with it from now on. */
  setCarrier(carrier: KnifeCarrier | null): void {
    this.carrier = carrier;
    this.stuck.forEach((k, i) => (this.carried[i] = carrier?.carries(k.x, k.y, k.z) ?? false));
    this.dirty = true;
  }

  /** The carrier moved: redraw the knives in it. */
  carrierMoved(): void {
    if (this.carried.includes(true)) this.dirty = true;
  }

  get flyingCount(): number {
    return this.flights.length;
  }

  /** Knives drawn this frame, stuck and flying. */
  get drawnCount(): number {
    return this.batches.count;
  }

  /** Knives drawn of each look, keyed `skin/finish`. */
  drawnLooks(): Record<string, number> {
    return this.batches.counts();
  }

  /** This player threw a knife, the one in `look`: draw it at once, before the server hears of it. */
  throwOwn(
    seq: number,
    from: number,
    state: KnifeState,
    online: boolean,
    hand?: { x: number; y: number; z: number },
    look: KnifeLook = DEFAULT_LOOK,
  ): void {
    // It flies from the eye, where it can hit, but starts where the hand let go and blends in.
    const ox = hand ? hand.x - state.x : 0;
    const oy = hand ? hand.y - state.y : 0;
    const oz = hand ? hand.z - state.z : 0;
    this.add({
      id: null,
      seq,
      from,
      state,
      clock: 0,
      online,
      outcome: null,
      landed: null,
      waited: 0,
      ox,
      oy,
      oz,
      look,
    });
  }

  /**
   * The server announced a throw. Our own is matched to the knife already flying; anyone else's
   * starts after `delay` seconds, so it leaves their hand as drawn (other players are shown slightly
   * in the past).
   */
  launch(
    id: number,
    from: number,
    seq: number,
    state: KnifeState,
    self: boolean,
    delay: number,
    look: KnifeLook = DEFAULT_LOOK,
  ): void {
    if (self) {
      const own = this.flights.find((f) => f.id === null && f.seq === seq);
      if (own) {
        own.id = id;
        return;
      }
    }
    this.add({
      id,
      seq: -1,
      from,
      state,
      clock: -delay,
      online: true,
      outcome: null,
      landed: null,
      waited: 0,
      ox: 0,
      oy: 0,
      oz: 0,
      look,
    });
  }

  /** Seconds until a knife's drawn flight reaches `at`; 0 if it is past that or unknown. */
  timeUntil(id: number, at: number): number {
    const flight = this.flights.find((f) => f.id === id);
    return flight ? Math.max(0, at - flight.clock) : 0;
  }

  /** The server's verdict on a knife: stuck somewhere, or in someone. */
  resolve(id: number, outcome: Outcome): void {
    const flight = this.flights.find((f) => f.id === id);
    if (flight) {
      flight.outcome = outcome;
      return;
    }
    // A knife we never saw thrown (we joined mid-flight): only where it ends up matters.
    if (outcome.kind === 'stuck') this.addStuck(outcome.knife);
  }

  /** Replace every stuck knife, as a newcomer's welcome lists them. Flights are forgotten. */
  reset(stuck: readonly StuckKnife[]): void {
    this.flights.length = 0;
    this.stuck.length = 0;
    this.carried.length = 0;
    this.stuckLooks.length = 0;
    for (const knife of stuck) this.addStuck(knife);
    this.maxCorrection = 0;
    this.dirty = true;
  }

  /** The connection is gone: knives in the air end where this screen says. */
  goOffline(): void {
    for (const flight of this.flights) flight.online = false;
  }

  /**
   * Advance every flight by `dt`. `targets` are the players as drawn on this screen; a knife flies
   * straight through anyone `spares(thrower, target)` says it does, as on the server.
   */
  update(dt: number, targets: readonly KnifeTarget[], spares?: Spares): void {
    for (let i = 0; i < this.flights.length; i++) {
      const f = this.flights[i]!;
      f.clock += dt;
      if (f.clock < 0) continue;
      if (!f.landed) {
        f.landed = flyKnife(
          f.state,
          Math.min(f.clock, KNIFE_MAX_FLIGHT_SECONDS) - f.state.t,
          spares ? this.hittable(targets, f.from, spares) : targets,
          f.from,
          this.coolerOpen,
        );
      } else {
        f.waited += dt;
      }
      if (this.finished(f)) {
        this.flights.splice(i, 1);
        i--;
      }
      this.dirty = true;
    }
    if (this.dirty) this.draw();
  }

  /** The `targets` a knife from `from` can hit, in a reused list. */
  private hittable(
    targets: readonly KnifeTarget[],
    from: number,
    spares: Spares,
  ): readonly KnifeTarget[] {
    const out = this.someTargets;
    out.length = 0;
    for (const target of targets) if (!spares(from, target.id)) out.push(target);
    return out;
  }

  /** Whether a flight is over, settling it if so. */
  private finished(f: Flight): boolean {
    if (f.outcome) {
      if (f.clock < f.outcome.at) return false;
      if (f.outcome.kind === 'stuck') {
        // From where the flight on this screen stopped (in a wall, or a cook as drawn here).
        const at = f.landed?.kind === 'surface' ? f.landed : f.state;
        const { x, y, z } = f.outcome.knife;
        const moved = Math.hypot(x - at.x, y - at.y, z - at.z);
        this.maxCorrection = Math.max(this.maxCorrection, moved);
        this.addStuck(f.outcome.knife);
      }
      return true;
    }
    const outOfTime = f.clock >= KNIFE_MAX_FLIGHT_SECONDS;
    if (!f.landed) return outOfTime;
    if (f.online && f.waited < VERDICT_TIMEOUT) return false;
    // Offline, or the verdict never came: it stays where it landed here.
    if (f.landed.kind === 'surface') {
      const knife = { id: f.id ?? this.nextLocalId--, ...pose(f.landed), ...lookFields(f.look) };
      this.addStuck(knife);
      if (!f.online) this.onOfflineStuck?.(knife);
    }
    return true;
  }

  private add(flight: Flight): void {
    if (this.flights.length >= MAX_FLYING) this.flights.shift();
    this.flights.push(flight);
    this.dirty = true;
  }

  private addStuck(knife: StuckKnife): void {
    if (this.stuck.some((k) => k.id === knife.id)) return;
    if (this.stuck.length >= KNIFE_MAX_STUCK) {
      this.stuck.shift();
      this.carried.shift();
      this.stuckLooks.shift();
      this.stuckMatrices.push(this.stuckMatrices.shift()!);
    }
    this.stuck.push(knife);
    this.carried.push(this.carrier?.carries(knife.x, knife.y, knife.z) ?? false);
    // As the server says it was thrown; anything this version does not know is the chef's knife.
    this.stuckLooks.push(knifeLook(knife.skin, knife.finish));
    this.stuckPose(knife, this.stuckMatrices[this.stuck.length - 1]!);
    this.dirty = true;
  }

  /** A knife with its tip at a point, the blade pointing into the surface. */
  private stuckPose(
    knife: { x: number; y: number; z: number; dx: number; dy: number; dz: number },
    out: Matrix4,
  ): void {
    this.q.setFromUnitVectors(FORWARD, this.v.set(knife.dx, knife.dy, knife.dz).normalize());
    out.compose(this.p.set(knife.x, knife.y, knife.z), this.q, this.scale);
  }

  private draw(): void {
    const batches = this.batches;
    batches.begin();
    for (let i = 0; i < this.stuck.length; i++) {
      const matrix = this.stuckMatrices[i]!;
      // Knives in the walk-in's door swing with it, each still the knife its thrower carried.
      const placed =
        this.carried[i] && this.carrier
          ? this.m.multiplyMatrices(this.carrier.motion, matrix)
          : matrix;
      batches.add(this.stuckLooks[i]!, placed);
    }
    for (const f of this.flights) {
      if (f.clock < 0) continue;
      if (f.landed) {
        // Landed here, waiting for the verdict: in a wall it shows; in a player it is gone.
        if (f.landed.kind === 'player') continue;
        this.stuckPose(f.landed, this.m);
        batches.add(f.look, this.m);
        continue;
      }
      // Tumbling end over end around its middle, along its flight.
      const s = f.state;
      this.q.setFromUnitVectors(FORWARD, this.v.set(s.vx, s.vy, s.vz).normalize());
      this.spin.setFromAxisAngle(this.xAxis, -f.clock * KNIFE_SPIN);
      this.q.multiply(this.spin);
      const fromHand = f.clock < HAND_BLEND ? 1 - easeOut(f.clock / HAND_BLEND) : 0;
      this.p.set(s.x + f.ox * fromHand, s.y + f.oy * fromHand, s.z + f.oz * fromHand);
      // Each knife tumbles about its own middle.
      const [cz, cy] = knifeCenter(f.look.skin);
      this.offset.makeTranslation(0, -cy, -cz);
      this.m.compose(this.p, this.q, this.scale).multiply(this.offset);
      batches.add(f.look, this.m);
    }
    batches.end();
    this.dirty = false;
  }
}

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t);

function pose(impact: Extract<KnifeImpact, { kind: 'surface' }>): Omit<StuckKnife, 'id'> {
  return { x: impact.x, y: impact.y, z: impact.z, dx: impact.dx, dy: impact.dy, dz: impact.dz };
}
