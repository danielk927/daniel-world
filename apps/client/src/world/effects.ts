import {
  AdditiveBlending,
  ConeGeometry,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from 'three';
import { createRandom } from '@world/shared';
import { worldTime } from './clock.ts';
import { softTexture } from './textures.ts';

/** Camera-facing quad, sized by the given size. */
const BILLBOARD_VERTEX = /* glsl */ `
  vec4 billboard(vec3 center, float size) {
    vec4 view = modelViewMatrix * vec4(center, 1.0);
    view.xy += position.xy * size;
    return projectionMatrix * view;
  }
`;

const tmpMatrix = new Matrix4();

/**
 * Rising steam over pots and the dish pit. Every puff loops on its own clock in the vertex shader,
 * so the CPU never touches it after construction.
 */
export function createSteam(
  sources: readonly { position: Vector3; strength: number }[],
): InstancedMesh {
  const random = createRandom(55);
  const perSource = 14;
  const count = sources.length * perSource;
  const seeds = new Float32Array(count);
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uTime: worldTime, uMap: { value: softTexture() } },
    vertexShader: /* glsl */ `
      ${BILLBOARD_VERTEX}
      uniform float uTime;
      attribute float aSeed;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vUv = uv;
        float strength = length(instanceMatrix[0].xyz);
        float t = fract(uTime * (0.16 + aSeed * 0.1) + aSeed * 7.0);
        vec3 center = instanceMatrix[3].xyz;
        center.y += t * (0.75 + aSeed * 0.4) * strength;
        center.x += sin(aSeed * 40.0 + uTime * 0.9) * 0.1 * t;
        center.z += cos(aSeed * 23.0 + uTime * 0.7) * 0.1 * t;
        vAlpha = smoothstep(0.0, 0.25, t) * (1.0 - t) * (1.0 - t) * 0.22 * strength;
        gl_Position = billboard(center, mix(0.16, 0.8, t) * (0.8 + strength * 0.2));
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        float a = texture2D(uMap, vUv).r * vAlpha;
        gl_FragColor = vec4(vec3(0.97, 0.96, 0.94), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const geometry = new PlaneGeometry(1, 1);
  const mesh = new InstancedMesh(geometry, material, count);
  sources.forEach((source, s) => {
    for (let i = 0; i < perSource; i++) {
      const index = s * perSource + i;
      tmpMatrix
        .makeScale(source.strength, source.strength, source.strength)
        .setPosition(
          source.position.x + (random() - 0.5) * 0.12,
          source.position.y,
          source.position.z + (random() - 0.5) * 0.12,
        );
      mesh.setMatrixAt(index, tmpMatrix);
      seeds[index] = random();
    }
  });
  geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1));
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = 'steam';
  return mesh;
}

/** Blue gas flames licking up around each lit burner, flickering in the vertex shader. */
export function createFlames(
  burners: readonly { position: Vector3; radius: number }[],
): InstancedMesh {
  const random = createRandom(66);
  const perBurner = 14;
  const geometry = new ConeGeometry(0.018, 0.06, 6, 1, true);
  // Base of the cone at the origin, so flames grow upward from the burner ring.
  geometry.translate(0, 0.03, 0);
  const seeds = new Float32Array(burners.length * perBurner);
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uTime: worldTime },
    vertexShader: /* glsl */ `
      uniform float uTime;
      attribute float aSeed;
      varying float vHeight;
      void main() {
        vec3 p = position;
        float flicker = 0.75 + 0.25 * sin(uTime * 23.0 + aSeed * 60.0) + 0.12 * sin(uTime * 41.0 + aSeed * 17.0);
        p.y *= flicker;
        p.x += sin(uTime * 9.0 + aSeed * 30.0) * 0.004 * position.y * 30.0;
        vHeight = position.y / 0.06;
        gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vHeight;
      void main() {
        vec3 blue = vec3(0.25, 0.45, 1.6);
        vec3 tip = vec3(1.4, 0.75, 0.35);
        vec3 color = mix(blue, tip, smoothstep(0.55, 1.0, vHeight));
        float a = 1.0 - smoothstep(0.6, 1.0, vHeight);
        gl_FragColor = vec4(color * a, a);
      }
    `,
  });
  const mesh = new InstancedMesh(geometry, material, burners.length * perBurner);
  burners.forEach((burner, b) => {
    for (let i = 0; i < perBurner; i++) {
      const index = b * perBurner + i;
      const angle = (i / perBurner) * Math.PI * 2;
      // Lean each flame outward a little, the way gas leaves a burner crown.
      tmpMatrix
        .makeRotationAxis(new Vector3(Math.cos(angle), 0, -Math.sin(angle)), 0.35)
        .setPosition(
          burner.position.x + Math.sin(angle) * burner.radius,
          burner.position.y,
          burner.position.z + Math.cos(angle) * burner.radius,
        );
      mesh.setMatrixAt(index, tmpMatrix);
      seeds[index] = random();
    }
  });
  geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1));
  mesh.frustumCulled = false;
  mesh.name = 'flames';
  return mesh;
}
