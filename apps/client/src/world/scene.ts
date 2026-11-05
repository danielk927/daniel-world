import {
  ACESFilmicToneMapping,
  Color,
  type Object3D,
  NoToneMapping,
  PCFShadowMap,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
  WebGLRenderTarget,
} from 'three';
import type { DishContent, StationContent } from '../content.ts';
import type { Quality } from '../util/capabilities.ts';
import { Avatars } from './avatars.ts';
import { ComputerScreen, buildComputerDesk } from './computer.ts';
import { CoolerDoor } from './cooler.ts';
import { worldTime } from './clock.ts';
import { createFlames, createSteam } from './effects.ts';
import { Kit } from './kit.ts';
import { Knives } from './knives.ts';
import { CLOCK_DISPLAY, CLOCK_SIZE, buildKitchen } from './kitchen.ts';
import { KitchenClock } from './kitchenClock.ts';
import { createLighting, type Lighting } from './lighting.ts';
import { storage } from '../util/storage.ts';
import { QualityGovernor, RENDER_LEVELS } from './governor.ts';
import type { PostProcessing } from './post.ts';
import { OutsideView } from './outside.ts';
import { buildStationProps } from './props.ts';
import { dressKnives } from './knifeModel.ts';
import { ReflectionProbe } from './reflections.ts';
import { dressKitchen } from './surfaces/dress.ts';
import { lookAt, pinnedHour, visitorHour } from './timeOfDay.ts';
import { assignShadowDepthMaterials } from './shadowDepth.ts';
import { Stations } from './stations.ts';
import { Viewmodel } from './viewmodel.ts';

export const BASE_FOV = 72;
const RENDER_LEVEL_KEY = 'world.renderLevel';

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
  /** The kitchen computer's screen, on the chef's desk. */
  readonly computer: ComputerScreen;
  /** The walk-in's door, its readout and the cold air from it, once it is open. */
  readonly cooler: CoolerDoor;
  /** The cold room behind it, only drawn when something of it can be seen. */
  private coolerRoom: Object3D | null = null;
  private readonly lighting: Lighting;
  /** The kitchen photographed for its own reflections. High quality only. */
  private readonly probe: ReflectionProbe | null;
  /** Ambient occlusion, bloom, tone mapping and the grade. High quality only. */
  private post: PostProcessing | null = null;
  /** Stands in for post-processing's buffers while shaders compile (see `compileFor`). High tier. */
  private readonly compileTarget: WebGLRenderTarget | null;
  /** Steps the high tier's cost down when the GPU falls behind; see governor.ts. */
  private governor: QualityGovernor | null = null;
  private frameDt = 0;
  /** The view outside, lit for the visitor's local time. */
  private readonly outside: OutsideView;
  /** The LED clock over the dining room doors, on the visitor's local time. */
  private readonly clock: KitchenClock;
  /** The quarter hour of the visitor's local time the look was painted for. */
  private quarter: number;
  /** Seconds until the clock is checked for a new quarter hour. */
  private lookCheck = 0;

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
    this.compileTarget = high ? new WebGLRenderTarget(1, 1) : null;

    // The sky outside covers every opening; this is the night above it, should a seam ever show.
    this.scene.background = new Color('#151f38');
    this.probe = high ? new ReflectionProbe(this.renderer) : null;
    this.lighting = createLighting(this.scene, quality, this.probe?.texture ?? null);
    this.viewmodel.matchLighting(high, this.scene.environment, this.scene.environmentIntensity);

    const hour = visitorHour(new Date(), location.search);
    this.quarter = Math.floor(hour * 4);
    const look = lookAt(hour);
    this.lighting.applyLook(look);
    this.outside = new OutsideView(look, high);
    this.scene.add(this.outside.group);
    this.clock = new KitchenClock(
      CLOCK_DISPLAY,
      CLOCK_SIZE.width,
      CLOCK_SIZE.height,
      pinnedHour(location.search),
      high,
    );
    this.scene.add(this.clock.mesh);

    const kit = new Kit(high);
    buildKitchen(kit);
    buildStationProps(kit);
    buildComputerDesk(kit);
    // The high tier paints its surfaces and reflects the room; the low tier stays plain paint.
    if (this.probe) dressKitchen(kit.materials, this.renderer, this.probe.texture);
    this.computer = new ComputerScreen(high);
    this.cooler = new CoolerDoor(high);
    if (this.probe) this.cooler.reflect(this.probe.texture);
    if (this.probe) {
      dressKnives(this.probe.texture);
      this.viewmodel.dress(this.renderer, this.probe.texture);
    }

    this.stations = new Stations(content, dishes, high);
    const kitchen = kit.builder.build();
    this.coolerRoom = kitchen.getObjectByName('cold') ?? null;
    this.scene.add(
      kitchen,
      createFlames(kit.burners),
      createSteam(kit.steam),
      this.stations.group,
      this.avatars.group,
      this.knives.group,
      this.computer.mesh,
      this.cooler.group,
    );
    assignShadowDepthMaterials(this.scene);
    // Knives stuck in the walk-in's door go with it when it swings open.
    this.knives.setCarrier(this.cooler);
    this.cooler.onMove = () => this.knives.carrierMoved();
    this.showCooler();

    this.resize();
  }

  /**
   * Start governing render cost against the display's refresh interval, from the level that held
   * on this device last time. High tier only: the low tier is already as cheap as it gets.
   */
  startGovernor(refreshMs: number): void {
    if (!this.post) return;
    const stored = Number(storage.get(RENDER_LEVEL_KEY));
    this.governor = new QualityGovernor(
      refreshMs,
      Number.isInteger(stored) ? stored : 0,
      window.devicePixelRatio,
    );
    this.applyRenderLevel(this.governor.level);
    this.watchDeviceRatio();
  }

  /**
   * Moving the window to a screen of another ratio need not resize it, so watch the ratio itself;
   * a query matches one ratio, so each change sets up the next.
   */
  private watchDeviceRatio(): void {
    matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
      'change',
      () => {
        this.resize();
        this.watchDeviceRatio();
      },
      { once: true },
    );
  }

  /** The governor's current level, or null without one. */
  get renderLevel(): number | null {
    return this.governor?.level ?? null;
  }

  private applyRenderLevel(index: number): void {
    const level = RENDER_LEVELS[index]!;
    this.post?.setQuality(level.msaa, level.ambientOcclusion);
    this.resize();
  }

  resize(): void {
    // The screen's ratio changes with the browser's zoom and from screen to screen; levels that drew
    // the same may not now, so the governor regroups them (the effects stay as they are).
    if (this.governor) {
      const ratio = window.devicePixelRatio;
      const changed = this.governor.setDeviceRatio(ratio);
      if (changed !== null) storage.set(RENDER_LEVEL_KEY, String(changed));
      const level = RENDER_LEVELS[this.governor.level]!;
      this.renderer.setPixelRatio(Math.min(ratio, level.pixelRatio));
    }
    const width = window.innerWidth;
    const height = window.innerHeight;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.post?.setSize(width, height);
  }

  /**
   * Compile every shader the visitor sees on arrival, so the first frames do not hitch. The
   * walk-in's light, which changes every lit shader, is left to `compileWalkInLight`.
   */
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
    await this.compileScene(false);
    await this.compileFor(this.viewmodel.scene);
    // With every shader ready, photograph the room for its reflections, as the visitor will see it.
    this.probe?.capture(this.scene);
  }

  /**
   * The walk-in's light is out of the lighting until its door opens, and every lit shader differs
   * with it, so the door opening would stall while they all compile again. Called once the kitchen
   * is up, so they compile in the background instead of holding up the loading.
   */
  compileWalkInLight(): Promise<void> {
    return this.compileScene(true);
  }

  /**
   * Compile the scene with the walk-in's light on or off, the cold room, its mist and the bulbs
   * outside included: they are hidden until they show, and a shader compiles only for what shows.
   * three.js gathers what to compile at once, so they show only for the call.
   */
  private async compileScene(coldLight: boolean): Promise<void> {
    this.cooler.mist.visible = true;
    if (this.coolerRoom) this.coolerRoom.visible = true;
    this.outside.showForCompile(true);
    const lit = this.cooler.light.visible;
    this.cooler.light.visible = coldLight;
    const compiled = this.compileFor(this.scene);
    this.cooler.light.visible = lit;
    this.outside.showForCompile(false);
    this.showCooler();
    await compiled;
  }

  /**
   * three.js compiles a shader for what it draws into, and the high tier draws the world into
   * post-processing's buffers, never straight to the canvas, so it compiles against a render target
   * (`compileTarget`); the low tier draws to the canvas, and compiles for it.
   */
  private async compileFor(scene: Object3D): Promise<void> {
    const target = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.compileTarget);
    const compiled = this.renderer.compileAsync(scene, this.camera);
    this.renderer.setRenderTarget(target);
    await compiled;
  }

  /**
   * Draw the cold room only when the walk-in's door shows any of it, and its mist once open; let
   * knives through the doorway once the door has swung clear of it.
   */
  private showCooler(): void {
    if (this.coolerRoom) this.coolerRoom.visible = this.cooler.showsInside;
    this.cooler.mist.visible = this.cooler.open;
    this.knives.coolerOpen = this.cooler.angle > 1;
  }

  update(time: number, dt: number): void {
    worldTime.value = time;
    this.frameDt = dt;
    const level = this.governor?.frame(dt * 1000) ?? null;
    if (level !== null) {
      this.applyRenderLevel(level);
      storage.set(RENDER_LEVEL_KEY, String(level));
    }
    this.stations.update(dt);
    this.lighting.update(time);
    this.followClock(dt);
    this.clock.update();
    this.computer.update(dt);
    this.cooler.update(time, dt);
    this.showCooler();
  }

  /**
   * Every quarter of an hour the light outside moves on: repaint the view and relight the room,
   * when the browser is idle, since painting takes a few tens of milliseconds.
   */
  private followClock(dt: number): void {
    this.lookCheck -= dt;
    if (this.lookCheck > 0) return;
    this.lookCheck = 20;
    const hour = visitorHour(new Date(), location.search);
    const quarter = Math.floor(hour * 4);
    if (quarter === this.quarter) return;
    this.quarter = quarter;
    const repaint = (): void => {
      const look = lookAt(hour);
      this.outside.repaint(look);
      this.lighting.applyLook(look);
      this.probe?.capture(this.scene);
    };
    if ('requestIdleCallback' in window) requestIdleCallback(repaint, { timeout: 2000 });
    else setTimeout(repaint, 0);
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
