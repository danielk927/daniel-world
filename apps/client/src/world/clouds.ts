import { DoubleSide, Mesh, PlaneGeometry, ShaderMaterial } from 'three';
import { palette } from './palette.ts';
import { worldTime } from './wind.ts';

/** A drifting sea of clouds below the island. One quad, all detail in the fragment shader. */
export function createCloudSea(): Mesh {
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
    uniforms: {
      uTime: worldTime,
      uLit: { value: palette.cloudLit },
      uShade: { value: palette.cloudShade },
      uHaze: { value: palette.belowHorizon },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uLit;
      uniform vec3 uShade;
      uniform vec3 uHaze;
      varying vec3 vWorld;

      float hash(vec2 p) {
        p = fract(p * vec2(123.34, 456.21));
        p += dot(p, p + 45.32);
        return fract(p.x * p.y);
      }
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
                   mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      float fbm(vec2 p) {
        float value = 0.0;
        float amplitude = 0.5;
        for (int i = 0; i < 5; i++) {
          value += amplitude * noise(p);
          p = p * 2.03 + vec2(17.1, 9.2);
          amplitude *= 0.5;
        }
        return value;
      }

      void main() {
        vec2 p = vWorld.xz * 0.012 + vec2(uTime * 0.006, uTime * 0.0025);
        float n = fbm(p + fbm(p * 0.6 - uTime * 0.004) * 0.8);
        float coverage = smoothstep(0.34, 0.72, n);
        vec3 color = mix(uShade, uLit, smoothstep(0.35, 0.85, n));
        float dist = length(vWorld.xz - cameraPosition.xz);
        float fade = 1.0 - smoothstep(380.0, 850.0, dist);
        color = mix(uHaze, color, fade);
        float alpha = mix(0.35, 0.95, coverage) * mix(0.55, 1.0, fade) * (1.0 - smoothstep(850.0, 950.0, dist));
        gl_FragColor = vec4(color, alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const mesh = new Mesh(new PlaneGeometry(2000, 2000), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -34;
  mesh.renderOrder = 0;
  return mesh;
}
