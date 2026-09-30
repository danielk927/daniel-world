import { BackSide, Mesh, ShaderMaterial, SphereGeometry } from 'three';
import { SUN_DIRECTION, palette } from './palette.ts';

/** Gradient sky dome with a sun disc and glow. Follows the camera, so it is never reached. */
export function createSky(): Mesh {
  const material = new ShaderMaterial({
    side: BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uSunDir: { value: SUN_DIRECTION },
      uZenith: { value: palette.zenith },
      uHorizon: { value: palette.horizon },
      uHorizonSun: { value: palette.horizonSun },
      uBelow: { value: palette.belowHorizon },
      uSun: { value: palette.sun },
    },
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position = clip.xyww;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uSunDir;
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uHorizonSun;
      uniform vec3 uBelow;
      uniform vec3 uSun;
      varying vec3 vDir;
      void main() {
        vec3 dir = normalize(vDir);
        float sunAmount = max(dot(dir, uSunDir), 0.0);
        vec3 horizon = mix(uHorizon, uHorizonSun, pow(sunAmount, 4.0));
        float up = clamp(dir.y, 0.0, 1.0);
        vec3 color = mix(horizon, uZenith, pow(smoothstep(0.0, 0.75, up), 0.7));
        color = mix(color, uBelow, smoothstep(0.02, -0.3, dir.y));
        color += uSun * (smoothstep(0.9993, 0.9997, sunAmount) * 2.5 + pow(sunAmount, 14.0) * 0.45);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const sky = new Mesh(new SphereGeometry(900, 48, 24), material);
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  return sky;
}
