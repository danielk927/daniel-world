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
  Scene,
  UnsignedByteType,
  WebGLRenderTarget,
  type Texture,
  type WebGLRenderer,
} from 'three';
import { KITCHEN, ROOM_HALF_X, ROOM_HALF_Z, type Footprint } from '@world/shared';

/**
 * The floor's shade, painted once from the layout: red is how open the floor is to the room (dark
 * under a counter's toe kick, at the foot of a wall, beside a plinth, under an island's shelves),
 * green how worn it is (polished by feet where cooks stand to work). A map of the whole room seen
 * from above, sampled by the floor's material by its world position. What screen-space occlusion
 * cannot see (a contact shadow that runs off screen, or one under a counter's overhang seen from
 * across the room) it holds steady.
 */

/** A footprint that shades the floor round it: how dark and how far, in meters. */
interface Shader {
  readonly f: Footprint;
  /** How dark right against it (0 none, 1 black). */
  readonly strength: number;
  /** How far the shade reaches. */
  readonly reach: number;
  /** How dark under it, for open-legged fixtures (islands, shelving); solid ones hide their floor. */
  readonly under: number;
}

const k = KITCHEN;
const SHADERS: readonly Shader[] = [
  { f: k.piano, strength: 0.55, reach: 0.22, under: 0.85 },
  { f: k.pass, strength: 0.55, reach: 0.2, under: 0.85 },
  { f: k.windowCounter, strength: 0.5, reach: 0.2, under: 0.85 },
  { f: k.plonge, strength: 0.5, reach: 0.2, under: 0.85 },
  { f: k.fridge, strength: 0.45, reach: 0.18, under: 0.85 },
  { f: k.gardeManger, strength: 0.25, reach: 0.35, under: 0.45 },
  { f: k.pastryIsland, strength: 0.25, reach: 0.35, under: 0.45 },
  { f: k.shelving, strength: 0.2, reach: 0.25, under: 0.35 },
  { f: k.panRack, strength: 0.2, reach: 0.25, under: 0.35 },
  { f: k.desk, strength: 0.2, reach: 0.25, under: 0.3 },
];

/** Where cooks stand to work: before the range, at the pass, the islands, the sinks. */
const WORN: readonly Footprint[] = [
  { minX: -4.6, maxX: 4.6, minZ: 1.45, maxZ: 2.4 },
  { minX: -4.6, maxX: 4.6, minZ: -2.4, maxZ: -1.45 },
  { minX: -4.3, maxX: 4.3, minZ: 3.1, maxZ: 3.85 },
  { minX: -5.0, maxX: -1.4, minZ: -3.65, maxZ: -2.9 },
  { minX: 1.4, maxX: 5.0, minZ: -3.65, maxZ: -2.9 },
  { minX: -6.0, maxX: 6.0, minZ: -5.8, maxZ: -5.15 },
  { minX: 4.8, maxX: 7.8, minZ: 5.1, maxZ: 5.8 },
];

/** The room the map covers. */
export const FLOOR_SHADE_BOUNDS = {
  minX: -ROOM_HALF_X,
  minZ: -ROOM_HALF_Z,
  sizeX: ROOM_HALF_X * 2,
  sizeZ: ROOM_HALF_Z * 2,
} as const;

const vec4 = (f: Footprint): string =>
  `vec4(${[f.minX, f.minZ, f.maxX, f.maxZ].map((n) => n.toFixed(4)).join(', ')})`;

function fragment(): string {
  return /* glsl */ `
precision highp float;
in vec2 vUv;
out vec4 outColor;
// Distance from p to a box (minX, minZ, maxX, maxZ), negative inside.
float boxDistance(vec2 p, vec4 b) {
  vec2 c = (b.xy + b.zw) * 0.5;
  vec2 h = (b.zw - b.xy) * 0.5;
  vec2 d = abs(p - c) - h;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
void main() {
  vec2 p = vec2(${FLOOR_SHADE_BOUNDS.minX.toFixed(4)}, ${FLOOR_SHADE_BOUNDS.minZ.toFixed(4)})
    + vUv * vec2(${FLOOR_SHADE_BOUNDS.sizeX.toFixed(4)}, ${FLOOR_SHADE_BOUNDS.sizeZ.toFixed(4)});
  float open = 1.0;
  // The foot of the walls.
  vec2 toWall = vec2(${ROOM_HALF_X.toFixed(4)}, ${ROOM_HALF_Z.toFixed(4)}) - abs(p);
  float wall = min(toWall.x, toWall.y);
  open *= 1.0 - 0.35 * exp(-max(wall, 0.0) / 0.12);
${SHADERS.map(
  ({ f, strength, reach, under }) => `  {
    float d = boxDistance(p, ${vec4(f)});
    open *= d < 0.0 ? 1.0 - ${under.toFixed(3)} * smoothstep(0.0, -0.08, d) - ${strength.toFixed(3)} * (1.0 - smoothstep(0.0, -0.08, d)) : 1.0 - ${strength.toFixed(3)} * exp(-d / ${reach.toFixed(3)});
  }`,
).join('\n')}
  float worn = 0.0;
${WORN.map(
  (f) => `  worn = max(worn, 1.0 - smoothstep(-0.25, 0.25, boxDistance(p, ${vec4(f)})));`,
).join('\n')}
  outColor = vec4(clamp(open, 0.0, 1.0), worn, 0.0, 1.0);
}
`;
}

/** Paint the floor's shade on the GPU: once, while loading, in a few milliseconds. */
export function paintFloorShade(renderer: WebGLRenderer): Texture {
  const target = new WebGLRenderTarget(1024, 832, {
    type: UnsignedByteType,
    colorSpace: NoColorSpace,
    generateMipmaps: true,
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
    depthBuffer: false,
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: /* glsl */ `
in vec3 position;
out vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`,
    fragmentShader: fragment(),
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(geometry, material);
  quad.frustumCulled = false;
  const scene = new Scene().add(quad);
  const previous = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  renderer.render(scene, new OrthographicCamera(-1, 1, 1, -1, 0, 1));
  renderer.setRenderTarget(previous);
  material.dispose();
  geometry.dispose();
  return target.texture;
}
