import {
  BufferGeometry,
  Float32BufferAttribute,
  GLSL3,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  NoColorSpace,
  OrthographicCamera,
  RawShaderMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  Scene,
  UnsignedByteType,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { NOISE_GLSL } from './noise.ts';

/**
 * A surface's textures, as a recipe the GPU paints at load: GLSL defining
 *
 *   void surface(vec2 uv, out vec3 color, out float height, out float roughness)
 *
 * for uv across one repeat, in [0, 1), which must tile (see noise.ts). `color` is linear albedo, a
 * multiplier on the part's paint; `height` is in meters, and becomes the normal map; `roughness`
 * goes into the normal map's alpha.
 */
export interface Recipe {
  /** Meters one repeat covers. */
  readonly meters: number;
  /** Texels across the color map, or 0 for a surface whose color is only its paint. */
  readonly colorSize: number;
  /** Texels across the normal and roughness map. */
  readonly normalSize: number;
  readonly glsl: string;
}

/** What a recipe paints: the color map (if it has one) and the normal map with roughness in alpha. */
export interface Painted {
  readonly map: Texture | null;
  readonly normalRoughness: Texture;
}

const VERTEX = /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

function fragment(recipe: Recipe, pass: 'color' | 'normal', size: number): string {
  const texel = (1 / size).toFixed(8);
  const meters = recipe.meters.toFixed(6);
  const main =
    pass === 'color'
      ? /* glsl */ `
  vec3 color; float height; float roughness;
  surface(vUv, color, height, roughness);
  outColor = vec4(clamp(color, 0.0, 1.0), 1.0);`
      : /* glsl */ `
  vec3 color; float height; float roughness;
  surface(vUv, color, height, roughness);
  vec3 c; float r; float hl; float hr; float hd; float hu;
  surface(fract(vUv - vec2(${texel}, 0.0)), c, hl, r);
  surface(fract(vUv + vec2(${texel}, 0.0)), c, hr, r);
  surface(fract(vUv - vec2(0.0, ${texel})), c, hd, r);
  surface(fract(vUv + vec2(0.0, ${texel})), c, hu, r);
  // Slopes in meters per meter, over two texels.
  float run = 2.0 * ${texel} * ${meters};
  vec3 n = normalize(vec3(-(hr - hl) / run, -(hu - hd) / run, 1.0));
  outColor = vec4(n * 0.5 + 0.5, clamp(roughness, 0.02, 1.0));`;
  return /* glsl */ `
precision highp float;
precision highp int;
in vec2 vUv;
out vec4 outColor;
${NOISE_GLSL}
${recipe.glsl}
void main() {${main}
}
`;
}

/**
 * Paints recipes into textures on the GPU: one draw of a full-screen triangle per map, into a
 * render target that repeats, has mipmaps (generated as it is drawn) and anisotropic filtering, so
 * fine detail averages out with distance instead of shimmering. The color map is stored sRGB, so
 * the darks keep their steps. A whole kitchen's worth takes a few milliseconds.
 */
export class TexturePainter {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly quad: Mesh;
  private readonly anisotropy: number;

  constructor(renderer: WebGLRenderer) {
    this.renderer = renderer;
    // One triangle covering the whole target.
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    );
    this.quad = new Mesh(geometry);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
    this.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  }

  paint(recipe: Recipe): Painted {
    const map = recipe.colorSize > 0 ? this.draw(recipe, 'color', recipe.colorSize) : null;
    const normalRoughness = this.draw(recipe, 'normal', recipe.normalSize);
    return { map, normalRoughness };
  }

  private draw(recipe: Recipe, pass: 'color' | 'normal', size: number): Texture {
    const target = new WebGLRenderTarget(size, size, {
      type: UnsignedByteType,
      colorSpace: pass === 'color' ? SRGBColorSpace : NoColorSpace,
      generateMipmaps: true,
      minFilter: LinearMipmapLinearFilter,
      magFilter: LinearFilter,
      wrapS: RepeatWrapping,
      wrapT: RepeatWrapping,
      anisotropy: this.anisotropy,
      depthBuffer: false,
    });
    const material = new RawShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERTEX,
      fragmentShader: fragment(recipe, pass, size),
      depthTest: false,
      depthWrite: false,
    });
    this.quad.material = material;
    const previous = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(previous);
    material.dispose();
    const texture = target.texture;
    texture.repeat.set(1 / recipe.meters, 1 / recipe.meters);
    return texture;
  }

  dispose(): void {
    this.quad.geometry.dispose();
  }
}
