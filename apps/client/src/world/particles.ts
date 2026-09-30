import {
  AdditiveBlending,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  ShaderMaterial,
} from 'three';
import { PLAY_RADIUS, createRandom, terrainHeight } from '@world/shared';
import { worldTime } from './wind.ts';

/** Drifting motes of warm light. All motion happens in the vertex shader. */
export function createMotes(pixelRatio: number): Points {
  const random = createRandom(17);
  const count = 420;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const angle = random() * Math.PI * 2;
    const r = Math.sqrt(random()) * (PLAY_RADIUS + 4);
    const x = Math.sin(angle) * r;
    const z = -Math.cos(angle) * r;
    positions[i * 3] = x;
    positions[i * 3 + 1] = terrainHeight(x, z) + 0.4 + random() * 5.5;
    positions[i * 3 + 2] = z;
    seeds[i] = random();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setAttribute('seed', new Float32BufferAttribute(seeds, 1));

  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uTime: worldTime, uPixelRatio: { value: pixelRatio } },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uPixelRatio;
      attribute float seed;
      varying float vAlpha;
      void main() {
        vec3 p = position;
        float t = uTime * (0.25 + seed * 0.3) + seed * 40.0;
        p.x += sin(t) * 0.9 + sin(t * 0.37) * 1.6;
        p.y += sin(t * 0.8 + seed * 6.0) * 0.45;
        p.z += cos(t * 0.9) * 0.9 + cos(t * 0.29) * 1.6;
        vec4 view = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * view;
        float twinkle = 0.55 + 0.45 * sin(uTime * (1.5 + seed * 2.0) + seed * 20.0);
        vAlpha = twinkle * (1.0 - smoothstep(30.0, 60.0, -view.z));
        gl_PointSize = (2.0 + seed * 3.0) * uPixelRatio * (18.0 / max(1.0, -view.z));
      }
    `,
    fragmentShader: /* glsl */ `
      varying float vAlpha;
      void main() {
        float d = length(gl_PointCoord - 0.5);
        float a = smoothstep(0.5, 0.0, d) * vAlpha;
        gl_FragColor = vec4(vec3(1.0, 0.86, 0.6) * a, a);
      }
    `,
  });
  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.name = 'motes';
  return points;
}
