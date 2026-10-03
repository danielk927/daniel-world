import { Mesh, type PerspectiveCamera } from 'three';
import { KNIFE_COOLDOWN_MS } from '@world/shared';
import { GRIP, knifeGeometry, knifeMaterial } from './knifeModel.ts';

/** Where the hand holding the knife sits in view: low and to the right, in camera space. */
const REST = { x: 0.2, y: -0.19, z: -0.3 };
/** Held pointing ahead and a little up, angled in toward the crosshair. */
const TILT = 0.32;
const TURN = 0.32;
const SIZE = 0.68;

/**
 * The knife in this player's own hand, drawn in front of the camera. It leaves with each throw and
 * slides back in as the next one is ready, so the cooldown is visible without any UI.
 */
export class Viewmodel {
  readonly mesh: Mesh;
  /** Seconds since the last throw. */
  private sinceThrow = Infinity;
  private shown = false;

  constructor(camera: PerspectiveCamera) {
    // Always drawn on top, so it never clips into a wall the player is pressed against.
    const material = knifeMaterial().clone();
    material.depthTest = false;
    material.depthWrite = false;
    this.mesh = new Mesh(knifeGeometry(), material);
    this.mesh.name = 'viewmodel';
    this.mesh.renderOrder = 1000;
    this.mesh.frustumCulled = false;
    this.mesh.scale.setScalar(SIZE);
    this.mesh.visible = false;
    camera.add(this.mesh);
  }

  /** Whether the player is holding a knife at all (in the world and standing). */
  setShown(shown: boolean): void {
    this.shown = shown;
    if (!shown) this.mesh.visible = false;
  }

  throw(): void {
    this.sinceThrow = 0;
  }

  update(dt: number, bob: number): void {
    this.sinceThrow += dt;
    if (!this.shown) return;
    const cooldown = KNIFE_COOLDOWN_MS / 1000;
    // Gone while the throw follows through, then rising back into view as the cooldown ends.
    const back = Math.min(1, Math.max(0, (this.sinceThrow - cooldown * 0.45) / (cooldown * 0.55)));
    const ease = 1 - (1 - back) ** 3;
    this.mesh.visible = ease > 0.01;
    const drop = (1 - ease) * 0.25;
    this.mesh.position.set(REST.x, REST.y - drop + bob, REST.z);
    // The grip sits at the hand; the model's tip is its origin, so offset along the blade.
    this.mesh.rotation.set(TILT - (1 - ease) * 0.6, TURN, 0, 'YXZ');
    this.mesh.translateZ(-GRIP * SIZE);
  }
}
