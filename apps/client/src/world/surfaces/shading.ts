import { ShaderChunk, Vector3, type Material, type Texture } from 'three';

/**
 * What the kitchen's materials add to three.js's physically based shading, by editing its shader
 * as it compiles:
 *
 * - a per-part finish (the builder's `finish` attribute), multiplying roughness, so one material
 *   can be glossy on one part and dull on the next;
 * - roughness from the painted normal map's alpha (see painter.ts), so a recipe's roughness costs
 *   no texture of its own;
 * - variation per tile, from a hash of the tile's cell, so tiles that a texture repeats every few
 *   tiles still all differ;
 * - reflections from the kitchen's probe (see reflections.ts), box-projected onto the room so they
 *   land where the room really is, and only a little light from it, since it is for reflections.
 */

/** The probe's place and the room's box, shared by every material that reflects it. */
export const probeUniforms = {
  probePosition: { value: new Vector3() },
  probeBoxMin: { value: new Vector3() },
  probeBoxMax: { value: new Vector3() },
  /** How much of the probe lights a surface diffusely: little, or it lights everything from every side. */
  probeDiffuse: { value: 0.05 },
};

/** Tiles that vary one by one. */
export interface TileVariation {
  /** The tile's size along the surface's u and v, in meters. */
  readonly size: readonly [number, number];
  /** Every other row shifted by half a tile. */
  readonly bond: boolean;
  /** How far a tile's color and roughness may stray, as fractions. */
  readonly color: number;
  readonly roughness: number;
}

export interface Shading {
  /** The material has a `finish` attribute to read. */
  readonly finish?: boolean;
  readonly tiles?: TileVariation;
}

const COMMON_VERTEX = /* glsl */ `
#include <common>
attribute float finish;
varying float vFinish;
varying vec3 vSurfaceWorld;
varying vec2 vMeters;
`;

const COMMON_FRAGMENT = /* glsl */ `
#include <common>
varying float vFinish;
varying vec3 vSurfaceWorld;
varying vec2 vMeters;
uniform vec3 probePosition;
uniform vec3 probeBoxMin;
uniform vec3 probeBoxMax;
uniform float probeDiffuse;
float surfaceHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
// Where a reflection ray from this point meets the room's box, as a direction from the probe.
vec3 boxProject(vec3 direction) {
  vec3 toMax = (probeBoxMax - vSurfaceWorld) / direction;
  vec3 toMin = (probeBoxMin - vSurfaceWorld) / direction;
  vec3 far = max(toMax, toMin);
  float distance = min(min(far.x, far.y), far.z);
  return vSurfaceWorld + direction * distance - probePosition;
}
`;

/** The probe's radiance, its ray box-projected; otherwise three.js's own. */
const BOX_PROJECTED_RADIANCE = ShaderChunk.envmap_physical_pars_fragment.replace(
  'reflectVec = transformDirectionByInverseViewMatrix( reflectVec, viewMatrix );',
  'reflectVec = boxProject( transformDirectionByInverseViewMatrix( reflectVec, viewMatrix ) );',
);

const DIM_IRRADIANCE = ShaderChunk.lights_fragment_maps.replace(
  'iblIrradiance += getIBLIrradiance( geometryNormal );',
  'iblIrradiance += getIBLIrradiance( geometryNormal ) * probeDiffuse;',
);

function tileCode(tiles: TileVariation): string {
  const [w, h] = tiles.size.map((n) => n.toFixed(5));
  return /* glsl */ `
  vec2 tileCell = vMeters / vec2(${w}, ${h});
  ${tiles.bond ? 'tileCell.x += mod(floor(tileCell.y), 2.0) * 0.5;' : ''}
  float tileHash = surfaceHash(floor(tileCell) + 41.0) - 0.5;
  diffuseColor.rgb *= 1.0 + ${(tiles.color * 2).toFixed(4)} * tileHash;
  float tileRoughness = 1.0 + ${(tiles.roughness * 2).toFixed(4)} * (surfaceHash(floor(tileCell) + 7.0) - 0.5);
`;
}

/** Edit `material`'s shader for the kitchen. Safe to call once per material. */
export function shadeSurface(material: Material, shading: Shading = {}): void {
  const key = `kitchen:${shading.finish ? 'f' : ''}:${shading.tiles ? JSON.stringify(shading.tiles) : ''}`;
  material.customProgramCacheKey = () => key;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, probeUniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', COMMON_VERTEX).replace(
      '#include <begin_vertex>',
      /* glsl */ `#include <begin_vertex>
  vFinish = ${shading.finish ? 'finish' : '1.0'};
  vMeters = uv;
  vSurfaceWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', COMMON_FRAGMENT)
      .replace('#include <envmap_physical_pars_fragment>', BOX_PROJECTED_RADIANCE)
      .replace('#include <lights_fragment_maps>', DIM_IRRADIANCE)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
${shading.tiles ? tileCode(shading.tiles) : '  float tileRoughness = 1.0;'}`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        /* glsl */ `#include <roughnessmap_fragment>
  #ifdef USE_NORMALMAP
    roughnessFactor *= texture2D( normalMap, vNormalMapUv ).a;
  #endif
  roughnessFactor = clamp( roughnessFactor * vFinish * tileRoughness, 0.03, 1.0 );`,
      );
  };
}

/** Give a material its painted maps: color (if any) and normal with roughness. */
export function applyPainted(
  material: Material & { map: Texture | null; normalMap: Texture | null; needsUpdate: boolean },
  map: Texture | null,
  normalRoughness: Texture,
): void {
  material.map = map;
  material.normalMap = normalRoughness;
  material.needsUpdate = true;
}
