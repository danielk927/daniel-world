import type { Material, WebGLProgramParametersWithUniforms } from 'three';

/** Shared clock for every shader-driven ambient animation. Updated once per frame. */
export const worldTime = { value: 0 };

/**
 * Make a material sway in the wind. Displacement grows with local height, so the base of a blade
 * of grass or a tree stays put. Works with instanced and regular meshes.
 */
export function addWindSway(material: Material, strength: number, heightScale: number): void {
  const uniforms = { uStrength: { value: strength }, uHeightScale: { value: heightScale } };
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    shader.uniforms.uTime = worldTime;
    shader.uniforms.uStrength = uniforms.uStrength;
    shader.uniforms.uHeightScale = uniforms.uHeightScale;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uTime;\nuniform float uStrength;\nuniform float uHeightScale;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 swayOrigin = instanceMatrix[3].xyz;
        #else
          vec3 swayOrigin = vec3(0.0);
        #endif
        float swayHeight = max(transformed.y, 0.0) * uHeightScale;
        float swayPhase = uTime * 1.35 + swayOrigin.x * 0.31 + swayOrigin.z * 0.23;
        transformed.x += (sin(swayPhase) + 0.35 * sin(swayPhase * 2.7)) * swayHeight * uStrength;
        transformed.z += cos(swayPhase * 0.83 + 1.3) * swayHeight * uStrength * 0.6;`,
      );
  };
  material.customProgramCacheKey = () => `wind-${strength}-${heightScale}`;
}
