import {
  CubeCamera,
  HalfFloatType,
  PMREMGenerator,
  Vector3,
  WebGLCubeRenderTarget,
  type Scene,
  type Texture,
  type WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import { ROOM_HALF_X, ROOM_HALF_Z, vaultHeight } from '@world/shared';
import { probeUniforms } from './surfaces/shading.ts';

/** Where the probe sees the kitchen from: over the aisle between the cooking suite and the pass. */
export const PROBE_POSITION = new Vector3(0, 1.75, 2.9);

/**
 * A reflection probe of the kitchen: the room as a cube map, seen from one point and filtered for
 * every roughness (PMREM), which the kitchen's materials box-project onto the room's box (see
 * surfaces/shading.ts), so a reflection of a lamp or a window lands where that lamp or window is.
 * Captured once the shaders are ready, and again whenever the hour's light moves on; never per
 * frame, so cooks and knives are not in it.
 */
export class ReflectionProbe {
  private readonly renderer: WebGLRenderer;
  private readonly cube = new WebGLCubeRenderTarget(256, { type: HalfFloatType });
  private readonly camera: CubeCamera;
  private readonly pmrem: PMREMGenerator;
  private readonly target: WebGLRenderTarget;

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
    this.camera = new CubeCamera(0.05, 60, this.cube);
    this.camera.position.copy(PROBE_POSITION);
    this.camera.updateMatrixWorld(true);
    this.pmrem = new PMREMGenerator(renderer);
    // Filtered once while still black, so materials can be compiled against it before the capture.
    this.target = this.pmrem.fromCubemap(this.cube.texture);
    probeUniforms.probePosition.value.copy(PROBE_POSITION);
    probeUniforms.probeBoxMin.value.set(-ROOM_HALF_X, 0, -ROOM_HALF_Z);
    probeUniforms.probeBoxMax.value.set(ROOM_HALF_X, vaultHeight(0), ROOM_HALF_Z);
  }

  /** The filtered room, for materials' `envMap`. The same texture after every capture. */
  get texture(): Texture {
    return this.target.texture;
  }

  /** Photograph the room as it is lit now. */
  capture(scene: Scene): void {
    this.camera.update(this.renderer, scene);
    this.pmrem.fromCubemap(this.cube.texture, this.target);
  }
}
