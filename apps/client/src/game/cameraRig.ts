import type { PerspectiveCamera, Vector3 } from 'three';
import { EYE_HEIGHT, WALK_SPEED } from '@world/shared';
import { BASE_FOV } from '../world/scene.ts';

/** A knife hit shakes the view this hard at first (radians), dying away over a few tenths of a second. */
const FLINCH_SHAKE = 0.035;
const FLINCH_KICK = 0.09;

/**
 * First-person camera feel: head bob, landing dip, a slight FOV kick while sprinting, and a flinch
 * when a knife hits.
 */
export class CameraRig {
  /** Scales head bob and shake; 0 with reduced motion. */
  motion = 1;
  /** The field of view at rest, in degrees; sprinting widens it a little. */
  baseFov = BASE_FOV;
  private flinch = 0;
  private time = 0;
  private bobPhase = 0;
  private bobAmount = 0;
  private dip = 0;
  private dipVelocity = 0;
  private fov = BASE_FOV;

  /** 0 standing, 1 knocked out: the view lies on the floor, rolled onto its side. */
  private down = 0;
  private knockedOut = false;

  private readonly camera: PerspectiveCamera;

  constructor(camera: PerspectiveCamera) {
    this.camera = camera;
  }

  /** Knocked out by a knife (true) or back on their feet (false). */
  setKnockedOut(knockedOut: boolean): void {
    this.knockedOut = knockedOut;
    // Standing up again is instant: the respawn already moved the player somewhere new.
    if (!knockedOut) this.down = 0;
  }

  /** A knife has hit: the head snaps back and the view shakes, dying away quickly. */
  hit(): void {
    this.flinch = 1;
  }

  /** A smaller jolt: a fist meeting something solid. */
  bump(): void {
    this.flinch = Math.max(this.flinch, 0.3);
  }

  /** A hard landing pushes the view down; the spring brings it back. */
  land(fallSpeed: number): void {
    this.dipVelocity -= Math.min(3.5, fallSpeed * 0.28);
  }

  update(
    dt: number,
    feet: Vector3,
    yaw: number,
    pitch: number,
    speed: number,
    grounded: boolean,
  ): void {
    this.time += dt;
    this.flinch *= Math.exp(-dt * 7);
    const walking = grounded && speed > 0.5;
    const targetBob = walking ? Math.min(1, speed / WALK_SPEED) : 0;
    this.bobAmount += (targetBob - this.bobAmount) * Math.min(1, dt * 8);
    if (walking) this.bobPhase += dt * (4.5 + speed * 0.9);

    // Critically damped spring toward zero dip.
    const stiffness = 90;
    const damping = 2 * Math.sqrt(stiffness);
    this.dipVelocity += (-stiffness * this.dip - damping * this.dipVelocity) * dt;
    this.dip += this.dipVelocity * dt;

    if (this.knockedOut) this.down += (1 - this.down) * Math.min(1, dt * 5);
    const down = this.down;

    const bob = this.bobAmount * this.motion;
    const bobY = Math.abs(Math.sin(this.bobPhase)) * 0.06 * bob;
    const bobSide = Math.sin(this.bobPhase) * 0.03 * bob;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    this.camera.position.set(
      feet.x + cos * bobSide,
      feet.y + (EYE_HEIGHT + bobY - 0.03 * bob + this.dip) * (1 - down) + 0.22 * down,
      feet.z - sin * bobSide,
    );
    const roll = Math.sin(this.bobPhase) * 0.004 * bob;
    // The flinch: a kick up and back, and a shake on two unrelated frequencies so it reads as noise.
    const shake = this.flinch * FLINCH_SHAKE * this.motion;
    const kick = this.flinch * FLINCH_KICK * this.motion;
    const shakePitch = Math.sin(this.time * 47) * shake + kick;
    const shakeRoll = Math.sin(this.time * 61 + 1.3) * shake;
    // Lying on one side, looking along the floor.
    this.camera.rotation.set(
      (pitch + shakePitch) * (1 - down) - 0.08 * down,
      yaw + Math.sin(this.time * 53 + 0.7) * shake * 0.6,
      roll + shakeRoll + 1.35 * down,
      'YXZ',
    );

    const targetFov = speed > WALK_SPEED + 1 ? this.baseFov + 7 : this.baseFov;
    this.fov += (targetFov - this.fov) * Math.min(1, dt * 6);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }
  }
}
