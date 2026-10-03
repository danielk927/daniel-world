import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  HemisphereLight,
  PCFShadowMap,
  PerspectiveCamera,
  PointLight,
  Scene,
  WebGLRenderer,
} from 'three';
import { KITCHEN, ROOM_HALF_X, ROOM_HALF_Z } from '@world/shared';
import type { DishContent, StationContent } from '../content.ts';
import type { Quality } from '../util/capabilities.ts';
import { Avatars } from './avatars.ts';
import { worldTime } from './clock.ts';
import { createFlames, createSteam } from './effects.ts';
import { Kit } from './kit.ts';
import { Knives } from './knives.ts';
import { buildKitchen } from './kitchen.ts';
import { buildStationProps } from './props.ts';
import { assignShadowDepthMaterials } from './shadowDepth.ts';
import { Stations } from './stations.ts';
import { Viewmodel } from './viewmodel.ts';

export const BASE_FOV = 72;

/** Owns the renderer and every static or ambient part of the world. */
export class WorldScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(BASE_FOV, 1, 0.05, 200);
  readonly stations: Stations;
  /** Remote players. Part of the scene from the start so their shaders compile during loading. */
  readonly avatars = new Avatars();
  /** Every knife stuck in the kitchen or in the air. */
  readonly knives = new Knives();
  /** The player's own arm, drawn over the world. */
  readonly viewmodel = new Viewmodel();
  /** Firelight from the burners on the piano, flickering. High quality only, with the pass light. */
  private readonly fireLight: PointLight | null = null;

  readonly quality: Quality;

  constructor(
    canvas: HTMLCanvasElement,
    content: StationContent,
    dishes: DishContent,
    quality: Quality,
  ) {
    this.quality = quality;
    const high = quality === 'high';
    this.renderer = new WebGLRenderer({
      canvas,
      antialias: high,
      powerPreference: 'high-performance',
    });
    // Low quality renders below native resolution; the browser scales the canvas up.
    this.renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio, 2) : 0.75);
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.info.autoReset = false;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = high;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.scene.background = new Color('#e9eef2');

    // Soft, even daylight: most of the light is fill, so faces never fall into dark shade.
    const hemi = new HemisphereLight('#f5f8fc', '#d6d2ca', 1.9);
    // Daylight from the skylights, as one key light from above that casts the shadows.
    const key = new DirectionalLight('#fffaf2', 1.7);
    // Angled toward the south, so the faces a new player looks at are lit, not only the tops.
    key.position.set(5, 13, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    const shadowCamera = key.shadow.camera;
    shadowCamera.left = -ROOM_HALF_X - 2;
    shadowCamera.right = ROOM_HALF_X + 2;
    shadowCamera.top = ROOM_HALF_Z + 3;
    shadowCamera.bottom = -ROOM_HALF_Z - 3;
    shadowCamera.near = 4;
    shadowCamera.far = 30;
    key.shadow.bias = -0.0004;
    key.shadow.normalBias = 0.03;
    key.shadow.radius = 4;
    // Shadows only hint at contact and depth; full-strength ones read as dark holes in a white room.
    key.shadow.intensity = 0.45;

    // Every point light costs every lit pixel, so software renderers go without the accent lights.
    if (high) {
      const pass = KITCHEN.pass;
      // A short reach, so the lamps warm the plates without washing the vault and walls orange.
      const passLight = new PointLight('#ffc08a', 1.6, 1.8, 2);
      passLight.position.set(0, 1.7, (pass.minZ + pass.maxZ) / 2);
      this.fireLight = new PointLight('#ffb070', 0.45, 2.2, 2);
      this.fireLight.position.set(0, 1.1, 0);
      this.scene.add(passLight, this.fireLight);
    }

    const kit = new Kit();
    buildKitchen(kit);
    buildStationProps(kit);

    this.stations = new Stations(content, dishes, high);
    this.scene.add(
      hemi,
      key,
      key.target,
      kit.builder.build(),
      createFlames(kit.burners),
      createSteam(kit.steam),
      this.stations.group,
      this.avatars.group,
      this.knives.mesh,
    );
    assignShadowDepthMaterials(this.scene);

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
    await this.renderer.compileAsync(this.viewmodel.scene, this.camera);
  }

  update(time: number, dt: number): void {
    worldTime.value = time;
    this.stations.update(dt);
    if (this.fireLight) {
      this.fireLight.intensity = 0.45 + Math.sin(time * 13) * 0.03 + Math.sin(time * 7.3) * 0.02;
    }
  }

  render(): void {
    // Two passes (the world, then the arm over it), so draw call counts add up across both.
    this.renderer.info.reset();
    this.renderer.render(this.scene, this.camera);
    this.viewmodel.render(this.renderer, this.camera);
  }
}
