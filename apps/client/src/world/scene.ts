import {
  ACESFilmicToneMapping,
  Color,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import type { DishContent, StationContent } from '../content.ts';
import type { Quality } from '../util/capabilities.ts';
import { Avatars } from './avatars.ts';
import { worldTime } from './clock.ts';
import { createFlames, createSteam } from './effects.ts';
import { Kit } from './kit.ts';
import { Knives } from './knives.ts';
import { buildKitchen } from './kitchen.ts';
import { createLighting, type Lighting } from './lighting.ts';
import type { PostProcessing } from './post.ts';
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
  private readonly lighting: Lighting;
  /** Ambient occlusion, bloom, tone mapping and the grade. High quality only. */
  private post: PostProcessing | null = null;
  private frameDt = 0;

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
    // With post-processing, tone mapping happens there, after bloom, instead of in every material.
    this.renderer.toneMapping = high ? NoToneMapping : ACESFilmicToneMapping;
    this.renderer.info.autoReset = false;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = high;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.scene.background = new Color('#e9eef2');
    this.lighting = createLighting(this.scene, this.renderer, quality);
    this.viewmodel.matchLighting(high, this.scene.environment, this.scene.environmentIntensity);

    const kit = new Kit(high);
    buildKitchen(kit);
    buildStationProps(kit);

    this.stations = new Stations(content, dishes, high);
    this.scene.add(
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
    this.post?.setSize(width, height);
  }

  /** Compile every shader up front so the first frames in the world do not hitch. */
  async compile(): Promise<void> {
    // Post-processing and the area lights' tables are only for the high tier, so only it downloads
    // them, while loading.
    if (this.quality === 'high') {
      const [{ PostProcessing }, { RectAreaLightUniformsLib }] = await Promise.all([
        import('./post.ts'),
        import('three/addons/lights/RectAreaLightUniformsLib.js'),
      ]);
      RectAreaLightUniformsLib.init();
      this.post = new PostProcessing(this.renderer, this.scene, this.camera, this.viewmodel.scene);
      this.post.setSize(window.innerWidth, window.innerHeight);
    }
    await this.renderer.compileAsync(this.scene, this.camera);
    await this.renderer.compileAsync(this.viewmodel.scene, this.camera);
  }

  update(time: number, dt: number): void {
    worldTime.value = time;
    this.frameDt = dt;
    this.stations.update(dt);
    this.lighting.update(time);
  }

  render(): void {
    // Two passes (the world, then the arm over it), so draw call counts add up across both.
    this.renderer.info.reset();
    if (this.post) {
      this.post.render(this.frameDt, this.viewmodel.isShown);
      return;
    }
    this.renderer.render(this.scene, this.camera);
    this.viewmodel.render(this.renderer, this.camera);
  }
}
