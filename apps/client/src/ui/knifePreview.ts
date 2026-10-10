import {
  AgXToneMapping,
  Box3,
  Color,
  DataTexture,
  DirectionalLight,
  DoubleSide,
  HemisphereLight,
  LinearMipmapLinearFilter,
  Mesh,
  MeshBasicMaterial,
  NoColorSpace,
  PMREMGenerator,
  PerspectiveCamera,
  PlaneGeometry,
  RGBAFormat,
  SRGBColorSpace,
  Scene,
  UnsignedByteType,
  Vector3,
  WebGLRenderer,
  type MeshStandardMaterial,
  type Texture,
} from 'three';
import type { KnifeLook } from '@world/shared';
import { finishPixels } from '../world/knifeFinishes.ts';
import { createKnifeMaterial, knifeGeometry } from '../world/knifeModel.ts';

/**
 * A photographer's studio for the knife to reflect: dark all round, as the menu behind it is, with
 * a softbox above, a large one to the front left where the key light is, and a cool strip behind
 * for the rim, so a turning blade catches bands of light and its steel reads as steel.
 */
function studio(): Scene {
  const room = new Scene();
  room.background = new Color('#0d1018');
  const softbox = (
    width: number,
    height: number,
    color: string,
    strength: number,
    at: readonly [number, number, number],
  ): void => {
    const panel = new Mesh(
      new PlaneGeometry(width, height),
      new MeshBasicMaterial({
        color: new Color(color).multiplyScalar(strength),
        side: DoubleSide,
      }),
    );
    panel.position.set(...at);
    panel.lookAt(0, 0, 0);
    room.add(panel);
  };
  softbox(4, 2.4, '#fff4e6', 2.2, [0, 3, 0.6]);
  softbox(2.2, 2.6, '#fff1de', 3.2, [-2.6, 1.4, 2.6]);
  softbox(0.5, 3, '#c9d6ff', 2.6, [2.4, 0.8, -2.6]);
  return room;
}

/** How far the knife rocks either way on its turntable, and how fast. */
const ROCK = 0.42;
const ROCK_SPEED = 0.55;

/**
 * A live look at one knife on the Knives page: a small renderer of its own, made only while the
 * page is showing and thrown away after, turning the knife slowly to the light. Drag to turn it.
 *
 * Everything it draws with is its own copy (geometry, material, texture), so throwing it away never
 * touches what the world is drawing with.
 */
export class KnifePreview {
  readonly element: HTMLElement;
  private renderer: WebGLRenderer | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private scene: Scene | null = null;
  private camera: PerspectiveCamera | null = null;
  private mesh: Mesh | null = null;
  private material: MeshStandardMaterial | null = null;
  /** Its own copies of the knives' color and surface textures. */
  private textures: [DataTexture, DataTexture] | null = null;
  private environment: Texture | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private frame = 0;
  private last = 0;
  private time = 0;
  /** Where a drag left it, added to the rocking. */
  private turned = 0;
  private dragging: { x: number; turned: number } | null = null;
  private look: KnifeLook | null = null;
  private still = false;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'knife-preview';
  }

  /** Show `look`, starting the renderer if it is not running. `still`: no rocking (reduce motion). */
  show(look: KnifeLook, still: boolean): void {
    this.still = still;
    if (!this.renderer && !this.start()) return;
    if (this.look && this.look.skin === look.skin && this.look.finish === look.finish) return;
    this.look = look;
    const mesh = this.mesh!;
    mesh.geometry.dispose();
    // The world's geometry paints the finish into the shared pixels; this copy uploads them again.
    mesh.geometry = knifeGeometry(look).clone();
    for (const texture of this.textures!) texture.needsUpdate = true;
    this.fit();
  }

  /** Stop drawing and give back everything the renderer held. */
  stop(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    if (this.renderer) {
      this.mesh?.geometry.dispose();
      this.material?.dispose();
      for (const texture of this.textures ?? []) texture.dispose();
      this.environment?.dispose();
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
    this.canvas?.remove();
    this.renderer = null;
    this.canvas = null;
    this.scene = null;
    this.camera = null;
    this.mesh = null;
    this.material = null;
    this.textures = null;
    this.environment = null;
    this.look = null;
  }

  get running(): boolean {
    return this.renderer !== null;
  }

  private start(): boolean {
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      // No WebGL for a second canvas: the page still works, without the picture.
      return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = AgXToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.setClearColor(0x000000, 0);
    this.element.append(canvas);
    this.canvas = canvas;
    this.renderer = renderer;

    const scene = new Scene();
    const pmrem = new PMREMGenerator(renderer);
    const room = studio();
    this.environment = pmrem.fromScene(room, 0.02).texture;
    room.traverse((o) => {
      const panel = o as Mesh<PlaneGeometry, MeshBasicMaterial>;
      if (!panel.isMesh) return;
      panel.geometry.dispose();
      panel.material.dispose();
    });
    pmrem.dispose();
    // Lit like a knife on a display: a warm key, a cool rim behind, a soft fill from below.
    scene.add(new HemisphereLight('#dfe6f5', '#3b3029', 1.1));
    const key = new DirectionalLight('#fff1de', 2.6);
    key.position.set(-1.5, 2.5, 3);
    const rim = new DirectionalLight('#a9bcff', 1.4);
    rim.position.set(1, 1.5, -3);
    scene.add(key, rim);

    const { color, surface, width, height } = finishPixels();
    const copy = (data: Uint8Array, colorSpace: string): DataTexture => {
      const texture = new DataTexture(data, width, height, RGBAFormat, UnsignedByteType);
      texture.colorSpace = colorSpace;
      texture.generateMipmaps = true;
      texture.minFilter = LinearMipmapLinearFilter;
      texture.anisotropy = 8;
      texture.needsUpdate = true;
      return texture;
    };
    this.textures = [copy(color, SRGBColorSpace), copy(surface, NoColorSpace)];
    const material = createKnifeMaterial(...this.textures);
    // Metal as in the kitchen, reflecting the studio: the kitchen's probe belongs to the world's
    // renderer, not this one.
    material.metalness = 1;
    material.envMap = this.environment;
    this.material = material;
    this.mesh = new Mesh(undefined, material);
    scene.add(this.mesh);
    this.scene = scene;
    this.camera = new PerspectiveCamera(24, 1, 0.01, 10);

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.element);
    this.resize();
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
    return true;
  }

  /** Frame the knife: centered, as long as most of the width. */
  private fit(): void {
    const mesh = this.mesh;
    const camera = this.camera;
    // Nothing to frame until a knife is shown.
    if (!mesh || !camera || !mesh.geometry.getAttribute('position')) return;
    const box = new Box3().setFromBufferAttribute(mesh.geometry.getAttribute('position') as never);
    const center = box.getCenter(new Vector3());
    // Turned so the tip points left: the model's length runs along the view's width.
    mesh.geometry.translate(-center.x, -center.y, -center.z);
    const length = box.max.z - box.min.z;
    const height = box.max.y - box.min.y;
    const halfFov = (camera.fov * Math.PI) / 360;
    const fitWidth = length / 0.84 / (2 * Math.tan(halfFov) * camera.aspect);
    const fitHeight = height / 0.7 / (2 * Math.tan(halfFov));
    camera.position.set(0, 0.02, Math.max(fitWidth, fitHeight));
    camera.lookAt(0, 0, 0);
  }

  private resize(): void {
    const renderer = this.renderer;
    const camera = this.camera;
    if (!renderer || !camera) return;
    const width = Math.max(1, this.element.clientWidth);
    const height = Math.max(1, this.element.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    this.fit();
  }

  private readonly tick = (now: number): void => {
    this.frame = requestAnimationFrame(this.tick);
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.dragging && !this.still) this.time += dt;
    const mesh = this.mesh;
    if (!mesh || !this.renderer || !this.scene || !this.camera) return;
    const rock = this.still ? 0.3 : Math.sin(this.time * ROCK_SPEED) * ROCK + 0.12;
    mesh.rotation.set(0.16, Math.PI / 2 + rock + this.turned, 0, 'XYZ');
    this.renderer.render(this.scene, this.camera);
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.dragging = { x: event.clientX, turned: this.turned };
    this.canvas?.setPointerCapture(event.pointerId);
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    if (!this.dragging) return;
    this.turned = this.dragging.turned + (event.clientX - this.dragging.x) * 0.012;
  };

  private readonly onPointerUp = (): void => {
    this.dragging = null;
  };
}
