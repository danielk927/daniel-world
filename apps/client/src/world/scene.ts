import {
  ACESFilmicToneMapping,
  DirectionalLight,
  Fog,
  HemisphereLight,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import type { LoreEntry } from '../content.ts';
import { createCloudSea } from './clouds.ts';
import { createDistantIslands } from './distant.ts';
import { createIsland, type Island } from './island.ts';
import { LoreObjects } from './lore.ts';
import { SUN_DIRECTION, palette } from './palette.ts';
import { createMotes } from './particles.ts';
import { createPlaza, type Plaza } from './plaza.ts';
import { createSky } from './sky.ts';
import { createVegetation } from './vegetation.ts';
import { worldTime } from './wind.ts';

export const BASE_FOV = 72;

/** Owns the renderer and every static or ambient part of the world. */
export class WorldScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(BASE_FOV, 1, 0.1, 2000);
  readonly lore: LoreObjects;
  private readonly island: Island;
  private readonly plaza: Plaza;
  private readonly sky = createSky();

  constructor(canvas: HTMLCanvasElement, entries: readonly LoreEntry[]) {
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.scene.fog = new Fog(palette.fog, 60, 420);
    this.scene.background = palette.horizon;

    const hemi = new HemisphereLight(palette.hemiSky, palette.hemiGround, 1.35);
    const sun = new DirectionalLight(palette.sunLight, 2.6);
    sun.position.copy(SUN_DIRECTION).multiplyScalar(90);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const shadowCamera = sun.shadow.camera;
    shadowCamera.left = -40;
    shadowCamera.right = 40;
    shadowCamera.top = 40;
    shadowCamera.bottom = -40;
    shadowCamera.near = 20;
    shadowCamera.far = 180;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    sun.shadow.radius = 2;

    this.island = createIsland();
    this.plaza = createPlaza();
    this.lore = new LoreObjects(entries);
    this.scene.add(
      hemi,
      sun,
      sun.target,
      this.sky,
      createCloudSea(),
      createDistantIslands(),
      this.island.group,
      this.plaza.group,
      createVegetation(),
      this.lore.group,
      createMotes(this.renderer.getPixelRatio()),
    );
    this.resize();
  }

  resize(): void {
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Compile every shader up front so the first frames in the world do not hitch. */
  async compile(): Promise<void> {
    await this.renderer.compileAsync(this.scene, this.camera);
  }

  update(time: number, dt: number): void {
    worldTime.value = time;
    this.island.update(dt);
    this.plaza.update(time);
    this.lore.update(time, dt);
    this.sky.position.copy(this.camera.position);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
