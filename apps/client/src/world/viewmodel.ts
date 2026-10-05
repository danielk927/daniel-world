import {
  Color,
  CylinderGeometry,
  DirectionalLight,
  Euler,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  Scene,
  Vector3,
  type PerspectiveCamera,
  type WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GRIP, KNIFE_CENTER, knifeGeometry, knifeMaterial } from './knifeModel.ts';

/**
 * The player's own arm, in the style of a CS2 view model: a white chef's sleeve and a hand coming
 * up from the bottom right, holding a knife or empty. It sways behind the mouse, bobs with each
 * step, breathes, and plays the throw (wind up, snap, follow through, draw a fresh knife), the
 * switch between knife and bare hand, the bare hand's punch, and the inspect: a long look at the
 * knife.
 *
 * It is drawn as a second pass, in its own scene, after clearing depth: it never clips into a wall,
 * and its parts still sort correctly against each other.
 */

/** Throw timeline, in seconds from the key press. The knife leaves the hand at RELEASE. */
export const THROW = {
  windUp: 0.09,
  release: 0.12,
  snap: 0.16,
  followThrough: 0.34,
  drawFrom: 0.5,
  drawTo: 0.8,
} as const;
/** Switching between knife and hand: the one lowers, then the other rises. */
export const SWITCH = { lower: 0.12, raise: 0.34 } as const;
/** How long the knife inspect lasts, in seconds. */
export const INSPECT = 2.6;
/** Punch timeline, in seconds from the press: a short draw back, the jab, and back to rest. */
export const PUNCH = { windUp: 0.05, hit: 0.13, recover: 0.42 } as const;
/** An inspect or punch cut short blends into what follows over this long, instead of jumping. */
const INTERRUPT_BLEND = 0.1;

/** Offsets from the resting pose, in camera space (meters and radians). */
export interface ArmPose {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  /** The knife is in the hand (not thrown yet, or drawn again). */
  knife: boolean;
  /** The flourish of a fresh knife being drawn: a spin about its own length. */
  spin: number;
}

const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const easeInCubic = (t: number): number => t * t * t;
const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Overshoots a little and settles, like a hand snapping into place. */
const easeOutBack = (t: number): number => {
  const c = 1.7;
  return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2;
};
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

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

/** Move `to` back toward `from`, by less as `t` runs from 0 to 1. */
function blend(from: ArmPose, to: ArmPose, t: number): void {
  const k = 1 - easeOutCubic(clamp01(t));
  to.x += (from.x - to.x) * k;
  to.y += (from.y - to.y) * k;
  to.z += (from.z - to.z) * k;
  to.rx += (from.rx - to.rx) * k;
  to.ry += (from.ry - to.ry) * k;
  to.rz += (from.rz - to.rz) * k;
  // A whole turn looks the same as none, so unwind the shorter way round.
  let spin = from.spin - to.spin;
  spin -= Math.PI * 2 * Math.round(spin / (Math.PI * 2));
  to.spin += spin * k;
}

/** Below the screen, where the arm goes while nothing is in hand. */
const LOWERED = { y: -0.34, rx: 0.5 };
/** Where the follow-through ends, out of view; the next knife is drawn up from here. */
const SPENT = { x: -0.04, y: LOWERED.y, z: 0, rx: 1.1, ry: -0.2, rz: 0.15 };

/** The arm `t` seconds into a throw. */
export function throwPose(t: number, out: ArmPose): ArmPose {
  out.spin = 0;
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
  } else if (t < THROW.drawTo) {
    // A fresh knife comes up from below, flipping once about its length as it settles.
    const k = (t - THROW.drawFrom) / (THROW.drawTo - THROW.drawFrom);
    const down = 1 - easeOutBack(k);
    set(
      out,
      SPENT.x * down,
      SPENT.y * down,
      SPENT.z * down,
      SPENT.rx * down,
      SPENT.ry * down,
      SPENT.rz * down,
    );
    out.spin = (1 - easeOutCubic(k)) * Math.PI * 2;
  } else {
    set(out, 0, 0, 0, 0, 0, 0);
  }
  return out;
}

/** The arm `t` seconds into a switch: lowering what was held, then raising the other. */
export function switchPose(t: number, out: ArmPose): ArmPose {
  out.spin = 0;
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

/** A pose at a time: seconds, then x, y, z, rx, ry, rz and spin, as in ArmPose. */
type Keyframe = readonly [number, number, number, number, number, number, number, number];

/** Eases between keyframes, settling into each one: the hand moves, holds, and moves on. */
function keyframes(frames: readonly Keyframe[], t: number, out: ArmPose): ArmPose {
  out.knife = true;
  let i = 0;
  while (i < frames.length - 2 && t >= frames[i + 1]![0]) i++;
  const a = frames[i]!;
  const b = frames[i + 1]!;
  const k = easeInOutCubic(clamp01((t - a[0]) / (b[0] - a[0])));
  set(
    out,
    lerp(a[1], b[1], k),
    lerp(a[2], b[2], k),
    lerp(a[3], b[3], k),
    lerp(a[4], b[4], k),
    lerp(a[5], b[5], k),
    lerp(a[6], b[6], k),
  );
  // A whole turn is the same as none; ending exactly at rest keeps the next spin from starting off.
  out.spin = t >= b[0] && i === frames.length - 2 ? 0 : lerp(a[7], b[7], k);
  return out;
}

/**
 * The knife inspect, after CS2's: the wrist rolls the knife over to lie across the view, the flat of
 * the blade to the eye, turns it to show the other side, tips it up for a last look, then spins it
 * home.
 */
const KNIFE_INSPECT: readonly Keyframe[] = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [0.5, -0.07, 0.07, 0.05, -0.1, 0, 1.2, Math.PI / 2],
  [1.15, -0.075, 0.072, 0.055, -0.14, 0.05, 1.28, Math.PI / 2 + 0.1],
  [1.6, -0.07, 0.07, 0.05, -0.1, 0, 1.2, (Math.PI * 3) / 2],
  [2.05, -0.06, 0.075, 0.05, -0.3, 0, 0.7, (Math.PI * 3) / 2 + 0.1],
  [INSPECT, 0, 0, 0, 0, 0, 0, Math.PI * 2],
];

/** The bare hand's jab: drawn back a touch, then straight out toward the crosshair and home. */
const PUNCH_FRAMES: readonly Keyframe[] = [
  [0, 0, 0, 0, 0, 0, 0, 0],
  [PUNCH.windUp, 0.01, -0.01, 0.03, 0.1, 0, 0, 0],
  [PUNCH.hit, -0.075, 0.05, -0.1, -0.2, -0.12, -0.15, 0],
  [PUNCH.recover, 0, 0, 0, 0, 0, 0, 0],
];

/** The arm `t` seconds into inspecting the knife. */
export function knifeInspectPose(t: number, out: ArmPose): ArmPose {
  return keyframes(KNIFE_INSPECT, t, out);
}

/** The arm `t` seconds into a punch. */
export function punchPose(t: number, out: ArmPose): ArmPose {
  return keyframes(PUNCH_FRAMES, t, out);
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
  private readonly knife: Mesh;
  private readonly knifeHolder = new Group();
  private readonly skin = new MeshStandardMaterial({
    color: '#ff7a59',
    roughness: 0.7,
    flatShading: true,
  });

  private shown = false;
  /** What the player asked to hold, and what the hand holds right now (they differ mid-switch). */
  private armed = true;
  private holding: 'knife' | 'hand' = 'knife';
  private sinceThrow = Infinity;
  private sinceSwitch = Infinity;
  private sinceInspect = Infinity;
  private sincePunch = Infinity;
  private sinceInterrupt = Infinity;
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

  private readonly pose: ArmPose = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, knife: true, spin: 0 };
  /** Where an interrupted inspect was, blended away from over INTERRUPT_BLEND. */
  private readonly interrupted: ArmPose = { ...this.pose };
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

    // The knife, gripped by its handle in the fist, the blade up. The holder spins it on draws.
    this.knife = new Mesh(knifeGeometry(), knifeMaterial());
    this.knife.scale.setScalar(KNIFE_SIZE);
    this.knife.quaternion.setFromUnitVectors(new Vector3(0, 0, -1), BLADE_UP);
    // The tip is the model's origin; put the grip at the holder's origin.
    this.knife.position.copy(BLADE_UP).multiplyScalar(GRIP * KNIFE_SIZE);
    this.knifeHolder.add(this.knife);

    this.arm.add(sleeve, cuff, this.fist, this.open, this.knifeHolder);
    this.arm.scale.setScalar(ARM_SCALE);
    this.root.add(this.arm);
    // Lit like the kitchen, so the arm belongs in the room.
    const key = new DirectionalLight('#fffaf2', 1.7);
    key.position.set(5, 13, 9);
    this.scene.add(new HemisphereLight('#f5f8fc', '#d6d2ca', 1.9), key, this.root);
    this.apply();
  }

  /** The hand takes the player's color, like their cook's hands. */
  setColor(color: string): void {
    this.skin.color.set(new Color(color));
  }

  /** Whether the arm is in view at all (in the world and standing). */
  setShown(shown: boolean): void {
    if (shown && !this.shown) {
      // Back in view: whatever is held comes up fresh.
      this.sinceThrow = Infinity;
      this.sinceSwitch = SWITCH.lower;
      this.sinceInspect = Infinity;
      this.sincePunch = Infinity;
      this.sinceInterrupt = Infinity;
      this.curl = 0;
      this.holding = this.armed ? 'knife' : 'hand';
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
  }

  /** Ready to throw: the knife is in hand, up, and no throw or switch is under way. */
  get canThrow(): boolean {
    return this.armed && this.holding === 'knife' && this.idle;
  }

  /**
   * Start the throw animation, cutting an inspect short. The caller launches the knife
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
    return this.sinceInspect < INSPECT;
  }

  /** Take a long look at the knife, if it is up and nothing else is going on. */
  startInspect(): boolean {
    if (!this.shown || !this.armed || this.holding !== 'knife' || this.inspecting || !this.idle) {
      return false;
    }
    this.sinceInspect = 0;
    this.sinceInterrupt = Infinity;
    return true;
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

  /** Cut an inspect or a punch short, blending out of wherever the arm was. */
  private interrupt(): void {
    if (!this.inspecting && !this.punching) return;
    Object.assign(this.interrupted, this.pose);
    this.sinceInspect = Infinity;
    this.sincePunch = Infinity;
    this.sinceInterrupt = 0;
  }

  /** The knife's middle in the world right now, where a knife leaving the hand starts from. */
  knifeCenter(out: Vector3): Vector3 {
    this.root.updateMatrixWorld(true);
    return this.knife.localToWorld(out.set(0, 0, KNIFE_CENTER));
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
    this.apply();
  }

  /** Draw the arm over the world. */
  render(renderer: WebGLRenderer, camera: PerspectiveCamera): void {
    if (!this.shown) return;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, camera);
    renderer.autoClear = true;
  }

  private apply(): void {
    const pose = this.pose;
    if (this.inspecting) knifeInspectPose(this.sinceInspect, pose);
    else if (this.punching) punchPose(this.sincePunch, pose);
    else if (this.sinceSwitch < SWITCH.raise) switchPose(this.sinceSwitch, pose);
    else if (this.holding === 'knife') throwPose(this.sinceThrow, pose);
    else switchPose(SWITCH.raise, pose);
    if (this.sinceInterrupt < INTERRUPT_BLEND)
      blend(this.interrupted, pose, this.sinceInterrupt / INTERRUPT_BLEND);
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
    this.knifeHolder.rotation.set(0, 0, 0);
    if (pose.spin) this.knifeHolder.rotateOnAxis(BLADE_UP, pose.spin);

    const bobX = Math.sin(this.bobPhase) * 0.011 * this.bobAmount;
    const bobY = Math.sin(this.bobPhase * 2) * 0.006 * this.bobAmount - 0.004 * this.bobAmount;
    const breath = Math.sin(this.time * 1.7) * 0.0022;
    this.arm.position.set(
      REST.x + pose.x - this.swayX + bobX,
      REST.y + pose.y + this.swayY + bobY + breath - this.air * 0.012,
      REST.z + pose.z,
    );
    this.euler.set(
      REST_ROTATION.x + pose.rx + this.swayY * 2,
      REST_ROTATION.y + pose.ry + this.swayX * 3,
      REST_ROTATION.z + pose.rz + this.swayX * 4 + bobX * 2,
      'YXZ',
    );
    this.arm.quaternion.setFromEuler(this.euler);
  }
}
