import {
  Color,
  CylinderGeometry,
  DirectionalLight,
  Euler,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Scene,
  Vector3,
  type Object3D,
  type PerspectiveCamera,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { DEFAULT_LOOK, sameLook, type KnifeLook } from '@world/shared';
import {
  CHANNELS,
  LOWERED,
  SPENT,
  SWITCH,
  THROW,
  TURNS,
  clip,
  easeInCubic,
  easeInOutCubic,
  easeOutBack,
  easeOutCubic,
  knifeMoves,
  sample,
  type ArmPose,
  type KnifeMoves,
  type Offset,
} from './knifeMoves.ts';
import { handKnifeMaterial, knifeModel, knifePartGeometry, type KnifeModel } from './knifeModel.ts';
import type { Joint } from './knifeShapes.ts';

/**
 * The player's own arm, in the style of a CS2 view model: a white chef's sleeve and a hand coming
 * up from the bottom right, holding a knife or empty. It sways behind the mouse, bobs with each
 * step, breathes, and plays the throw (wind up, snap, follow through, draw a fresh knife), the
 * switch between knife and bare hand, the bare hand's punch, and the knife's own draw, idle and
 * inspect, which each knife has its own of (knifeMoves.ts).
 *
 * It is drawn as a second pass, in its own scene, after clearing depth: it never clips into a wall,
 * and its parts still sort correctly against each other.
 */

export { SWITCH, THROW, type ArmPose };
/** How long the chef's knife's inspect lasts, in seconds. */
export const INSPECT = knifeMoves('kitchen').inspect.duration;
/** Punch timeline, in seconds from the press: a short draw back, the jab, and back to rest. */
export const PUNCH = { windUp: 0.05, hit: 0.13, recover: 0.42 } as const;
/**
 * An inspect, punch, flourish or idle cut short by a throw or a switch blends into it over this
 * long: done before the knife leaves the hand.
 */
const INTERRUPT_BLEND = 0.1;
/**
 * An inspect blends in over this long out of whatever it cuts short, another inspect included:
 * long enough that pressing I over and over never jolts the knife much harder than an inspect
 * itself does, short enough that every press visibly starts it over.
 */
const INSPECT_BLEND = 0.3;
/** How quickly the motion a cut carries on with dies away, per second. */
const CARRY = 10;

const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const smoothstep = (t: number): number => t * t * (3 - 2 * t);
/** The shorter way from `a` to `b`, for angles where a whole turn is the same as none. */
const turn = (a: number, b: number): number => {
  const d = a - b;
  return d - Math.PI * 2 * Math.round(d / (Math.PI * 2));
};

function set(
  out: ArmPose,
  x: number,
  y: number,
  z: number,
  rx: number,
  ry: number,
  rz: number,
): void {
  out.x = x;
  out.y = y;
  out.z = z;
  out.rx = rx;
  out.ry = ry;
  out.rz = rz;
}

/** The knife held still in the hand: not turned, its parts open. */
function still(out: ArmPose): void {
  out.spin = 0;
  out.flip = 0;
  out.a = 0;
  out.b = 0;
  out.hang = 0;
}

/**
 * Blend `to` in, `t` seconds into a cut that lasts `duration`, out of where the arm was when cut
 * (`from`) carried on at the speed it was going (`speed`), dying away. The arm keeps its place and
 * its speed through the cut, so however often cuts come, it never jumps or jolts.
 */
function blend(from: ArmPose, speed: ArmPose, to: ArmPose, t: number, duration: number): void {
  const k = 1 - smoothstep(clamp01(t / duration));
  const carried = (1 - Math.exp(-CARRY * t)) / CARRY;
  for (let i = 0; i < CHANNELS.length; i++) {
    const c = CHANNELS[i]!;
    to[c] += (from[c] + speed[c] * carried - to[c]) * k;
  }
}

/**
 * Turn `from`'s angles by whole turns, which look the same, to within half a turn of `aim`, where
 * the cut is headed once blended: the knife goes the shorter way there, and is not spun a whole
 * turn round to reach a pose it is already in. Chosen once, as the cut is made, so the way round
 * cannot flip partway.
 */
function unwind(from: ArmPose, aim: Readonly<ArmPose>): void {
  for (let i = 0; i < TURNS.length; i++) {
    const c = TURNS[i]!;
    from[c] = aim[c] + turn(from[c], aim[c]);
  }
}

/** The arm at rest, the knife not turned: where a throw or a switch has the knife's turns. */
const AT_REST: Readonly<ArmPose> = {
  x: 0,
  y: 0,
  z: 0,
  rx: 0,
  ry: 0,
  rz: 0,
  knife: true,
  spin: 0,
  flip: 0,
  a: 0,
  b: 0,
  hang: 0,
};

const KITCHEN = knifeMoves('kitchen');

/**
 * The arm `t` seconds into a throw: wind up, snap, follow through, then a fresh knife drawn up as
 * the knife in hand draws (`moves.redraw`).
 */
export function throwPose(t: number, out: ArmPose, moves: KnifeMoves = KITCHEN): ArmPose {
  still(out);
  out.knife = t < THROW.release || t >= THROW.drawFrom;
  if (t < THROW.windUp) {
    // Draw back past the ear, blade tipping back.
    const k = easeOutCubic(t / THROW.windUp);
    set(out, 0.03 * k, 0.07 * k, 0.1 * k, -0.75 * k, 0.15 * k, -0.1 * k);
  } else if (t < THROW.snap) {
    // The snap: fastest at the moment of release, through the middle of the view and down.
    const k = easeInOutCubic(clamp01((t - THROW.windUp) / (THROW.snap - THROW.windUp)));
    set(
      out,
      0.03 - 0.11 * k,
      0.07 - 0.1 * k,
      0.1 - 0.27 * k,
      -0.75 + 1.6 * k,
      0.15 - 0.35 * k,
      -0.1 + 0.25 * k,
    );
  } else if (t < THROW.followThrough) {
    // Follow through: the empty hand, extended, drops away out of view.
    const k = easeInCubic((t - THROW.snap) / (THROW.followThrough - THROW.snap));
    const e = SPENT;
    set(
      out,
      -0.08 + (e.x + 0.08) * k,
      -0.03 + (e.y + 0.03) * k,
      -0.17 + (e.z + 0.17) * k,
      0.85 + (e.rx - 0.85) * k,
      -0.2 + (e.ry + 0.2) * k,
      0.15 + (e.rz - 0.15) * k,
    );
  } else if (t < THROW.drawFrom) {
    set(out, SPENT.x, SPENT.y, SPENT.z, SPENT.rx, SPENT.ry, SPENT.rz);
  } else {
    // A fresh knife comes up from below, as this knife draws.
    sample(moves.redraw, t - THROW.drawFrom, out);
  }
  return out;
}

/** The arm `t` seconds into a switch: lowering what was held, then raising the other. */
export function switchPose(t: number, out: ArmPose): ArmPose {
  still(out);
  out.knife = true;
  if (t < SWITCH.lower) {
    const k = easeInCubic(t / SWITCH.lower);
    set(out, 0, LOWERED.y * k, 0, LOWERED.rx * k, 0, 0);
  } else {
    const k = easeOutBack(clamp01((t - SWITCH.lower) / (SWITCH.raise - SWITCH.lower)));
    set(out, 0, LOWERED.y * (1 - k), 0, LOWERED.rx * (1 - k), 0, 0);
  }
  return out;
}

/** The bare hand's jab: drawn back a touch, then straight out toward the crosshair and home. */
const PUNCH_CLIP = clip([
  { t: 0 },
  { t: PUNCH.windUp, x: 0.01, y: -0.01, z: 0.03, rx: 0.1 },
  { t: PUNCH.hit, x: -0.075, y: 0.05, z: -0.1, rx: -0.2, ry: -0.12, rz: -0.15 },
  { t: PUNCH.recover, x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 },
]);

/** The arm `t` seconds into inspecting the chef's knife. */
export function knifeInspectPose(t: number, out: ArmPose): ArmPose {
  return sample(KITCHEN.inspect, t, out);
}

/** The arm `t` seconds into a punch. */
export function punchPose(t: number, out: ArmPose): ArmPose {
  return sample(PUNCH_CLIP, t, out);
}

/** Where the hand rests in view: low and to the right. */
const REST = new Vector3(0.17, -0.19, -0.36);
/** The forearm runs back and down to the bottom right corner, out of view. */
const REST_ROTATION = new Euler(0.55, 0.45, 0.12, 'YXZ');
/** The knife stands up out of the fist, leaning forward. */
const BLADE_UP = new Vector3(0, 0.82, -0.57).normalize();
const KNIFE_SIZE = 0.78;
/** The whole arm, hand and knife, scaled to sit in view the way a CS2 view model does. */
const ARM_SCALE = 0.72;

/** How the fist turns the chef's knife: its tip along BLADE_UP, its spine toward the eye. */
const CHEF_HOLD = new Quaternion().setFromUnitVectors(new Vector3(0, 0, -1), BLADE_UP);
/**
 * A basis for the fist from where, seen at rest, the tip points and the spine faces, in camera space
 * (x right, y up, -z ahead): easier to judge by eye than in the arm's own turned frame.
 */
function holdFromView(tip: Vector3, spine: Vector3): Quaternion {
  const toArm = new Quaternion().setFromEuler(REST_ROTATION).invert();
  const back = tip.normalize().applyQuaternion(toArm).negate();
  const up = spine.applyQuaternion(toArm);
  up.sub(back.clone().multiplyScalar(up.dot(back))).normalize();
  const side = new Vector3().crossVectors(up, back);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(side, up, back));
}

/**
 * A karambit's grip: the ring on the finger over the fist and the claw curling out of its heel
 * toward the middle of the view, the flat of the blade to the eye.
 */
const REVERSE_HOLD = holdFromView(new Vector3(-0.5, -0.85, -0.2), new Vector3(1, 0, 0));

const HOLDS: Readonly<Record<KnifeModel['hold'], Quaternion>> = {
  chef: CHEF_HOLD,
  // Up and toward the middle of the view, the flat of the blade to the eye and the edge inward.
  forward: holdFromView(new Vector3(-0.3, 0.9, -0.3), new Vector3(1, 0, 0.4)),
  reverse: REVERSE_HOLD,
};

const NO_OFFSET: Readonly<Offset> = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0 };

const SLEEVE = '#f2f0e9';
const CUFF = '#dedad0';

export class Viewmodel {
  readonly scene = new Scene();
  private readonly root = new Group();
  private readonly arm = new Group();
  private readonly fist: Mesh;
  private readonly open: Group;
  /** The bare hand's fingers hinge here, at the knuckles, to curl into a fist. */
  private readonly knuckles = new Group();
  private readonly openThumb: Mesh;
  /** How far the bare hand is curled into a fist: 0 open, 1 clenched. */
  private curl = 0;
  /** The knife: held at the grip, turned about its length, turned end over end about its pivot. */
  private readonly knifeHolder = new Group();
  private readonly spinner = new Group();
  private readonly flipper = new Group();
  private readonly model = new Group();
  /** The knife's moving parts, each turned by a pose channel. */
  private joints: { readonly group: Group; readonly joint: Joint }[] = [];
  private current: KnifeModel = knifeModel(DEFAULT_LOOK.skin);
  /** From the grip to the pivot, in the knife's space: how far it slides to hang from its ring. */
  private readonly toPivot = new Vector3();
  private currentLook: KnifeLook = DEFAULT_LOOK;
  private moves: KnifeMoves = KITCHEN;
  private readonly skin = new MeshStandardMaterial({
    color: '#ff7a59',
    roughness: 0.7,
    flatShading: true,
  });

  /** Lit like the kitchen around it; see matchLighting. */
  private readonly fill = new HemisphereLight('#f5f8fc', '#d6d2ca', 1.9);
  private readonly key = new DirectionalLight('#fffaf2', 1.7);
  private shown = false;
  /** What the player asked to hold, and what the hand holds right now (they differ mid-switch). */
  private armed = true;
  private holding: 'knife' | 'hand' = 'knife';
  private sinceThrow = Infinity;
  private sinceSwitch = Infinity;
  private sinceInspect = Infinity;
  private sincePunch = Infinity;
  private sinceInterrupt = Infinity;
  /** How long the blend out of the last cut lasts. */
  private interruptBlend = INTERRUPT_BLEND;
  /** The draw's flourish was cut short: the arm stops playing it, though the knife is up no sooner. */
  private drawCut = false;
  /** How long the knife has rested in hand with nothing going on: the idle plays on this. */
  private idleTime = 0;
  private time = 0;

  // Sway, bob and breathing state.
  private lastYaw = 0;
  private lastPitch = 0;
  private swayX = 0;
  private swayY = 0;
  private swayVX = 0;
  private swayVY = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private air = 0;

  private readonly pose: ArmPose = {
    x: 0,
    y: 0,
    z: 0,
    rx: 0,
    ry: 0,
    rz: 0,
    knife: true,
    spin: 0,
    flip: 0,
    a: 0,
    b: 0,
    hang: 0,
  };
  /** The pose last frame, and how fast each of its channels is changing, per second. */
  private readonly lastPose: ArmPose = { ...this.pose };
  private readonly poseSpeed: ArmPose = { ...this.pose };
  /** Where the arm was when last cut short, and how fast it was going; blended away from. */
  private readonly interrupted: ArmPose = { ...this.pose };
  private readonly interruptedSpeed: ArmPose = { ...this.pose };
  /** Where an inspect will be once blended in. */
  private readonly inspectAim: ArmPose = { ...this.pose };
  private readonly euler = new Euler(0, 0, 0, 'YXZ');

  constructor() {
    const sleeveMaterial = new MeshStandardMaterial({
      color: SLEEVE,
      roughness: 0.9,
      flatShading: true,
    });
    const cuffMaterial = new MeshStandardMaterial({
      color: CUFF,
      roughness: 0.9,
      flatShading: true,
    });
    // The forearm runs along +Z, from the wrist at the origin back toward the elbow.
    const sleeve = new Mesh(
      new CylinderGeometry(0.036, 0.05, 0.36, 8).rotateX(Math.PI / 2),
      sleeveMaterial,
    );
    sleeve.position.z = 0.24;
    const cuff = new Mesh(
      new CylinderGeometry(0.041, 0.041, 0.035, 8).rotateX(Math.PI / 2),
      cuffMaterial,
    );
    cuff.position.z = 0.065;
    this.fist = new Mesh(new RoundedBoxGeometry(0.068, 0.072, 0.082, 2, 0.022), this.skin);
    const thumb = new Mesh(new RoundedBoxGeometry(0.026, 0.026, 0.05, 1, 0.01), this.skin);
    thumb.position.set(-0.03, 0.022, -0.012);
    thumb.rotation.y = 0.35;
    this.fist.add(thumb);
    // The bare hand: a flat palm with the fingers relaxed and a little curled.
    this.open = new Group();
    const palm = new Mesh(new RoundedBoxGeometry(0.074, 0.024, 0.08, 2, 0.01), this.skin);
    const fingers = new Mesh(new RoundedBoxGeometry(0.07, 0.02, 0.06, 2, 0.009), this.skin);
    fingers.position.set(0, -0.002, -0.028);
    this.knuckles.position.set(0, -0.004, -0.038);
    this.knuckles.add(fingers);
    this.openThumb = new Mesh(new RoundedBoxGeometry(0.022, 0.02, 0.048, 1, 0.009), this.skin);
    this.open.add(palm, this.knuckles, this.openThumb);

    // The knife, gripped in the fist. The holder turns it to the grip; the rest animate it.
    this.knifeHolder.scale.setScalar(KNIFE_SIZE);
    this.knifeHolder.add(this.spinner);
    this.spinner.add(this.flipper);
    this.flipper.add(this.model);
    this.build(DEFAULT_LOOK);

    this.arm.add(sleeve, cuff, this.fist, this.open, this.knifeHolder);
    this.arm.scale.setScalar(ARM_SCALE);
    this.root.add(this.arm);
    this.key.position.set(5, 13, 9);
    this.scene.add(this.fill, this.key, this.root);
    this.apply();
  }

  /**
   * Light the arm like the room it is in: in the evening kitchen of the high tier, a warm key from
   * the lamps over a low, cool fill, instead of the bright even daylight of the low tier.
   */
  matchLighting(evening: boolean, environment: Texture | null, environmentIntensity: number): void {
    // The blade reflects the same kitchen as everything else in it.
    this.scene.environment = environment;
    this.scene.environmentIntensity = environmentIntensity;
    if (!evening) return;
    this.fill.color.set('#7d90b0');
    this.fill.groundColor.set('#6f5a4b');
    this.fill.intensity = 0.8;
    this.key.color.set('#ffd6a8');
    this.key.intensity = 1.5;
    this.key.position.set(2, 8, 5);
  }

  /** The hand takes the player's color, like their cook's hands. */
  setColor(color: string): void {
    this.skin.color.set(new Color(color));
  }

  /** The knife the player carries. A new one is drawn the next time the arm comes into view. */
  setLook(look: KnifeLook): void {
    if (sameLook(look, this.currentLook)) return;
    this.interrupt();
    this.sinceInspect = Infinity;
    this.build(look);
    // Whatever was going on belonged to the last knife; draw this one fresh.
    if (this.armed) {
      this.sinceSwitch = SWITCH.lower;
      this.drawCut = false;
    }
    this.jump();
  }

  get look(): KnifeLook {
    return this.currentLook;
  }

  /** Put a knife's parts in the hand, each moving part in its own hinge. */
  private build(look: KnifeLook): void {
    for (const child of [...this.model.children]) this.model.remove(child);
    this.joints = [];
    const model = knifeModel(look.skin);
    this.current = model;
    this.currentLook = look;
    this.moves = knifeMoves(look.skin);
    const hinges = new Map<string, Group>();
    const hingeFor = (joint: Joint): Group => {
      const existing = hinges.get(`${joint.channel}:${joint.parent ?? ''}`);
      if (existing) return existing;
      const parentPart = joint.parent ? model.parts.find((p) => p.name === joint.parent) : null;
      const parent = parentPart?.joint ? hingeFor(parentPart.joint) : this.model;
      // Turn about the pivot, then put the part back in model space inside it.
      const hinge = new Group();
      hinge.position.set(0, joint.pivot[1], joint.pivot[0]);
      const inner = new Group();
      inner.position.set(0, -joint.pivot[1], -joint.pivot[0]);
      hinge.add(inner);
      parent.add(hinge);
      hinges.set(`${joint.channel}:${joint.parent ?? ''}`, inner);
      this.joints.push({ group: hinge, joint });
      return inner;
    };
    for (const part of model.parts) {
      const mesh = new Mesh(knifePartGeometry(look, part), handKnifeMaterial());
      const parent: Object3D = part.joint ? hingeFor(part.joint) : this.model;
      parent.add(mesh);
    }
    this.knifeHolder.quaternion.copy(HOLDS[model.hold]);
    // The grip at the holder's origin; turned end over end about the pivot.
    const [gz, gy] = model.grip;
    const [pz, py] = model.pivot;
    this.toPivot.set(0, py - gy, pz - gz);
    this.flipper.position.copy(this.toPivot);
    this.model.position.set(0, -py, -pz);
  }

  /** Whether the arm is in view at all (in the world and standing). */
  setShown(shown: boolean): void {
    if (shown && !this.shown) {
      // Back in view: whatever is held comes up fresh.
      this.sinceThrow = Infinity;
      this.sinceSwitch = SWITCH.lower;
      this.drawCut = false;
      this.sinceInspect = Infinity;
      this.sincePunch = Infinity;
      this.sinceInterrupt = Infinity;
      this.idleTime = 0;
      this.curl = 0;
      this.holding = this.armed ? 'knife' : 'hand';
      this.jump();
    }
    this.shown = shown;
  }

  get isShown(): boolean {
    return this.shown;
  }

  /** Hold the knife (true) or the bare hand (false). Switching plays the lower-and-raise. */
  setArmed(armed: boolean): void {
    if (armed === this.armed) return;
    this.interrupt();
    this.armed = armed;
    this.sinceThrow = Infinity;
    this.sinceSwitch = 0;
    this.drawCut = false;
  }

  /** Ready to throw: the knife is in hand, up, and no throw or switch is under way. */
  get canThrow(): boolean {
    return this.armed && this.holding === 'knife' && this.idle;
  }

  /**
   * Start the throw animation, cutting an inspect or a flourish short. The caller launches the knife
   * THROW.release seconds later.
   */
  startThrow(): boolean {
    if (!this.canThrow) return false;
    this.interrupt();
    this.sinceThrow = 0;
    return true;
  }

  /** How far the next knife is from ready: 0 just after letting go, 1 once it is drawn and up. */
  get knifeReadiness(): number {
    // Until the hand lets go, the knife is still in it.
    if (this.sinceThrow < THROW.release) return 1;
    return clamp01((this.sinceThrow - THROW.release) / (THROW.drawTo - THROW.release));
  }

  /** Mid-inspect. */
  get inspecting(): boolean {
    return this.sinceInspect < this.moves.inspect.duration;
  }

  /** How far into its inspect the knife is, in seconds, or null if it is not being inspected. */
  get inspectTime(): number | null {
    return this.inspecting ? this.sinceInspect : null;
  }

  /**
   * Take a long look at the knife, if it is in hand: not thrown, nor put away. As in CS2, every
   * press starts the inspect over, even mid-inspect, and it may cut the draw short the moment the
   * knife is in the hand, though it can be thrown only once it is all the way up.
   */
  startInspect(): boolean {
    if (!this.knifeInHand) return false;
    this.interrupt(INSPECT_BLEND, sample(this.moves.inspect, INSPECT_BLEND, this.inspectAim));
    this.sinceInspect = 0;
    return true;
  }

  /** The knife is in the hand in view, if still coming up: not thrown, nor on its way down. */
  private get knifeInHand(): boolean {
    return (
      this.shown &&
      this.armed &&
      this.holding === 'knife' &&
      this.sinceSwitch >= SWITCH.lower &&
      this.sinceThrow >= THROW.drawTo
    );
  }

  /** Mid-punch. */
  get punching(): boolean {
    return this.sincePunch < PUNCH.recover;
  }

  /** How far the bare hand is curled into a fist: 0 open, 1 clenched. */
  get handCurl(): number {
    return this.curl;
  }

  /** Jab with the bare hand, if it is up and not already punching. */
  startPunch(): boolean {
    if (!this.shown || this.armed || this.holding !== 'hand' || this.punching || !this.idle) {
      return false;
    }
    this.sincePunch = 0;
    this.sinceInterrupt = Infinity;
    return true;
  }

  /** Nothing in progress: whatever is in hand is up, and not being thrown or switched. */
  private get idle(): boolean {
    const raised =
      this.sinceSwitch >= SWITCH.raise && this.holding === (this.armed ? 'knife' : 'hand');
    return raised && (this.holding === 'hand' || this.sinceThrow >= THROW.drawTo);
  }

  /**
   * The knife's draw still playing out: an inspect may cut it short as soon as the knife is in the
   * hand, and anything once the knife is up, when what is left of it is its flourish.
   */
  private get flourishing(): boolean {
    return (
      this.holding === 'knife' &&
      !this.drawCut &&
      this.sinceSwitch < SWITCH.lower + this.moves.draw.duration
    );
  }

  /** At rest with the knife up, playing its idle. */
  private get idling(): boolean {
    return (
      this.holding === 'knife' &&
      this.idle &&
      !this.flourishing &&
      !this.inspecting &&
      this.moves.idle.duration > 0
    );
  }

  /**
   * Cut an inspect, a punch, a flourish or the idle short, blending over `duration` out of wherever
   * the arm was, at the speed it was going, into what follows; `aim` is where that has the knife's
   * turns once blended in.
   */
  private interrupt(duration = INTERRUPT_BLEND, aim: Readonly<ArmPose> = AT_REST): void {
    const flourish = this.flourishing && this.sinceSwitch >= SWITCH.lower;
    if (!this.inspecting && !this.punching && !flourish && !(this.idling && this.idleTime > 0))
      return;
    Object.assign(this.interrupted, this.pose);
    Object.assign(this.interruptedSpeed, this.poseSpeed);
    unwind(this.interrupted, aim);
    this.sinceInspect = Infinity;
    this.sincePunch = Infinity;
    if (flourish) this.drawCut = true;
    this.idleTime = 0;
    this.sinceInterrupt = 0;
    this.interruptBlend = duration;
  }

  /** The knife's middle in the world right now, where a knife leaving the hand starts from. */
  knifeCenter(out: Vector3): Vector3 {
    this.root.updateMatrixWorld(true);
    const [cz, cy] = this.current.center;
    return this.model.localToWorld(out.set(0, cy, cz));
  }

  /** Follow the camera and animate. `speed` and `grounded` drive the walk bob. */
  update(
    dt: number,
    camera: PerspectiveCamera,
    yaw: number,
    pitch: number,
    speed: number,
    grounded: boolean,
  ): void {
    this.time += dt;
    this.sinceThrow += dt;
    this.sinceSwitch += dt;
    this.sinceInspect += dt;
    this.sincePunch += dt;
    this.sinceInterrupt += dt;
    this.idleTime = this.idling ? this.idleTime + dt : 0;
    // The hand clenches quickly for the jab and opens again more slowly once it is on the way back;
    // easing toward the target means it can never snap, even mid-punch or when punches overlap.
    const clench = this.sincePunch < PUNCH.hit + 0.1 ? 1 : 0;
    const rate = clench > this.curl ? 45 : 9;
    this.curl += (clench - this.curl) * (1 - Math.exp(-dt * rate));
    if (this.sinceSwitch >= SWITCH.lower) this.holding = this.armed ? 'knife' : 'hand';
    this.root.position.copy(camera.position);
    this.root.quaternion.copy(camera.quaternion);

    // Sway: the arm lags behind the look and springs back, like a weight in the hand.
    if (dt > 0) {
      let dYaw = yaw - this.lastYaw;
      dYaw -= Math.PI * 2 * Math.round(dYaw / (Math.PI * 2));
      const dPitch = pitch - this.lastPitch;
      const targetX = Math.max(-0.035, Math.min(0.035, (dYaw / dt) * 0.006));
      const targetY = Math.max(-0.03, Math.min(0.03, (-dPitch / dt) * 0.006));
      const stiffness = 160;
      const damping = 2 * Math.sqrt(stiffness) * 0.85;
      this.swayVX += ((targetX - this.swayX) * stiffness - this.swayVX * damping) * dt;
      this.swayVY += ((targetY - this.swayY) * stiffness - this.swayVY * damping) * dt;
      this.swayX += this.swayVX * dt;
      this.swayY += this.swayVY * dt;
    }
    this.lastYaw = yaw;
    this.lastPitch = pitch;
    // Walk bob: a figure eight, stronger when sprinting.
    const walking = grounded && speed > 0.5;
    this.bobAmount +=
      ((walking ? Math.min(1.4, speed / 5) : 0) - this.bobAmount) * Math.min(1, dt * 8);
    if (walking) this.bobPhase += dt * (4.5 + speed * 0.9);
    this.air += ((grounded ? 0 : 1) - this.air) * Math.min(1, dt * 10);
    Object.assign(this.lastPose, this.pose);
    this.apply();
    this.trackSpeed(dt);
  }

  /**
   * The arm was put somewhere new on purpose: pose it there at once, and still, so that a cut
   * before the next frame starts from where it now is, and carries no speed from where it was.
   */
  private jump(): void {
    this.apply();
    for (let i = 0; i < CHANNELS.length; i++) this.poseSpeed[CHANNELS[i]!] = 0;
  }

  /** How fast the pose is changing, for a cut to carry on with. */
  private trackSpeed(dt: number): void {
    if (dt <= 0) return;
    for (let i = 0; i < CHANNELS.length; i++) {
      const c = CHANNELS[i]!;
      // A whole turn looks the same as none, and a clip unwinds its turns as it ends.
      const d = TURNS.includes(c)
        ? turn(this.pose[c], this.lastPose[c])
        : this.pose[c] - this.lastPose[c];
      this.poseSpeed[c] = d / dt;
    }
  }

  /** Draw the arm over the world. */
  render(renderer: WebGLRenderer, camera: PerspectiveCamera): void {
    if (!this.shown) return;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, camera);
    renderer.autoClear = true;
  }

  /** The arm's pose this frame: whatever is going on, as the held knife does it. */
  private poseNow(pose: ArmPose): void {
    const moves = this.moves;
    if (this.inspecting) sample(moves.inspect, this.sinceInspect, pose);
    else if (this.punching) punchPose(this.sincePunch, pose);
    else if (this.sinceSwitch < SWITCH.lower) switchPose(this.sinceSwitch, pose);
    else if (this.holding === 'knife' && this.flourishing)
      sample(moves.draw, this.sinceSwitch - SWITCH.lower, pose);
    else if (this.holding === 'hand') switchPose(Math.min(this.sinceSwitch, SWITCH.raise), pose);
    else if (this.sinceThrow < THROW.drawTo) throwPose(this.sinceThrow, pose, moves);
    else if (this.idling) sample(moves.idle, this.idleTime % moves.idle.duration, pose);
    else throwPose(THROW.drawTo, pose, moves);
  }

  private apply(): void {
    const pose = this.pose;
    this.poseNow(pose);
    if (this.sinceInterrupt < this.interruptBlend) {
      blend(
        this.interrupted,
        this.interruptedSpeed,
        pose,
        this.sinceInterrupt,
        this.interruptBlend,
      );
    }
    const knife = this.holding === 'knife' && pose.knife;
    this.knifeHolder.visible = knife;
    this.fist.visible = this.holding === 'knife';
    this.open.visible = this.holding === 'hand';
    // The bare hand curls into a fist: fingers fold under the palm, the thumb across them, and the
    // wrist straightens behind the knuckles.
    const c = this.curl;
    this.knuckles.rotation.x = lerp(-0.35, -2.6, c);
    this.openThumb.position.set(
      lerp(-0.042, -0.03, c),
      lerp(0.004, -0.02, c),
      lerp(-0.02, -0.036, c),
    );
    this.openThumb.rotation.set(0, lerp(0.55, -0.45, c), 0);
    this.open.rotation.set(lerp(0.15, 0, c), lerp(0.1, 0, c), lerp(-0.3, 0, c));
    // The knife turns about its length (toward its tip), end over end about its pivot, and opens.
    this.spinner.rotation.set(0, 0, -pose.spin);
    this.flipper.rotation.set(pose.flip, 0, 0);
    this.flipper.position.copy(this.toPivot).multiplyScalar(1 - pose.hang);
    for (const { group, joint } of this.joints) {
      group.rotation.x = joint.sign * (joint.channel === 'a' ? pose.a : pose.b);
    }

    // The held knife's own resting place; the pose itself stays relative to it.
    const rest = this.holding === 'knife' ? this.moves.rest : NO_OFFSET;

    const bobX = Math.sin(this.bobPhase) * 0.011 * this.bobAmount;
    const bobY = Math.sin(this.bobPhase * 2) * 0.006 * this.bobAmount - 0.004 * this.bobAmount;
    const breath = Math.sin(this.time * 1.7) * 0.0022;
    this.arm.position.set(
      REST.x + rest.x + pose.x - this.swayX + bobX,
      REST.y + rest.y + pose.y + this.swayY + bobY + breath - this.air * 0.012,
      REST.z + rest.z + pose.z,
    );
    this.euler.set(
      REST_ROTATION.x + rest.rx + pose.rx + this.swayY * 2,
      REST_ROTATION.y + rest.ry + pose.ry + this.swayX * 3,
      REST_ROTATION.z + rest.rz + pose.rz + this.swayX * 4 + bobX * 2,
      'YXZ',
    );
    this.arm.quaternion.setFromEuler(this.euler);
  }
}
