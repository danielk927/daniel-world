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
import type { StationContent } from '../content.ts';
import type { Quality } from '../util/capabilities.ts';
import { Avatars } from './avatars.ts';
import { worldTime } from './clock.ts';
import { createFlames, createSteam } from './effects.ts';
import { Kit } from './kit.ts';
import { buildKitchen } from './kitchen.ts';
import { buildStationProps } from './props.ts';
import { assignShadowDepthMaterials } from './shadowDepth.ts';
import { Stations } from './stations.ts';

export const BASE_FOV = 72;

/** Owns the renderer and every static or ambient part of the world. */
export class WorldScene {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(BASE_FOV, 1, 0.05, 200);
  readonly stations: Stations;
  /** Remote players. Part of the scene from the start so their shaders compile during loading. */
  readonly avatars = new Avatars();
  /** Firelight from the burners on the piano, flickering. High quality only, with the pass light. */
  private readonly fireLight: PointLight | null = null;

  readonly quality: Quality;

  constructor(canvas: HTMLCanvasElement, content: StationContent, quality: Quality) {
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
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.shadowMap.enabled = high;
    this.renderer.shadowMap.type = PCFShadowMap;

    this.scene.background = new Color('#e9eef2');

    const hemi = new HemisphereLight('#f5f8fc', '#c9c5bd', 1.25);
    // Daylight from the skylights, as one key light from above that casts the shadows.
    const key = new DirectionalLight('#fffaf2', 2.6);
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
    key.shadow.radius = 2;

    // Every point light costs every lit pixel, so software renderers go without the accent lights.
    if (high) {
      const pass = KITCHEN.pass;
      const passLight = new PointLight('#ff8a45', 5, 5, 1.6);
      passLight.position.set(0, 1.9, (pass.minZ + pass.maxZ) / 2);
      this.fireLight = new PointLight('#ff9b52', 0.9, 3, 1.6);
      this.fireLight.position.set(0, 1.1, 0);
      this.scene.add(passLight, this.fireLight);
    }

    const kit = new Kit();
    buildKitchen(kit);
    buildStationProps(kit);

    this.stations = new Stations(content, high);
    this.scene.add(
      hemi,
      key,
      key.target,
      kit.builder.build(),
      createFlames(kit.burners),
      createSteam(kit.steam),
      this.stations.group,
      this.avatars.group,
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
  }

  update(time: number, dt: number): void {
    worldTime.value = time;
    this.stations.update(dt);
    if (this.fireLight) {
      this.fireLight.intensity = 0.9 + Math.sin(time * 13) * 0.1 + Math.sin(time * 7.3) * 0.08;
    }
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }
}
