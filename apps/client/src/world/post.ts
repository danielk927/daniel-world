import {
  BlendFunction,
  BloomEffect,
  Effect,
  EffectComposer,
  EffectPass,
  NoiseEffect,
  RenderPass,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import {
  Color,
  HalfFloatType,
  Uniform,
  Vector3,
  type PerspectiveCamera,
  type Scene,
  type WebGLRenderer,
} from 'three';

/**
 * The grade, after Sharon Calahan's lighting on Ratatouille: shadows never go to grey or black but
 * to a warm, very dark red-brown ("warm blacks"), highlights lean a touch warm the way food is
 * photographed, and a gentle S-curve gives the contrast of a well-exposed film frame. Works on
 * tone-mapped color, in a perceptual (gamma) space so the lift lands in the shadows.
 */
const gradeShader = /* glsl */ `
uniform vec3 lift;
uniform vec3 gain;
uniform float contrast;
uniform float saturation;

void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = pow(max(inputColor.rgb, 0.0), vec3(1.0 / 2.2));
  // Warm blacks: lift the darkest tones toward a deep red-brown, fading out by the midtones.
  c += lift * (1.0 - c) * (1.0 - c);
  // Warm highlights, scaled in by brightness so the shadows keep their own color.
  c *= mix(vec3(1.0), gain, c);
  // A soft S-curve around the middle grey.
  c = mix(c, c * c * (3.0 - 2.0 * c), contrast);
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(luma), c, saturation);
  outputColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(2.2)), inputColor.a);
}
`;

class GradeEffect extends Effect {
  constructor() {
    super('GradeEffect', gradeShader, {
      uniforms: new Map<string, Uniform>([
        ['lift', new Uniform(new Vector3(0.032, 0.014, 0.008))],
        ['gain', new Uniform(new Vector3(1.02, 1.0, 0.97))],
        ['contrast', new Uniform(0.22)],
        ['saturation', new Uniform(1.06)],
      ]),
    });
  }
}

/**
 * The high quality frame: the kitchen into a multisampled HDR buffer, ambient occlusion tinted
 * warm instead of grey, the player's arm over it (cleared depth, so it never clips into walls), then
 * one pass for bloom on the lamps and flames, filmic tone mapping, the grade, a vignette and a
 * little film grain.
 */
export class PostProcessing {
  private readonly composer: EffectComposer;
  private readonly ao: N8AOPostPass;
  private readonly arm: RenderPass;

  constructor(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera, overlay: Scene) {
    this.composer = new EffectComposer(renderer, {
      multisampling: 4,
      frameBufferType: HalfFloatType,
    });
    this.composer.addPass(new RenderPass(scene, camera));

    this.ao = new N8AOPostPass(scene, camera, 1, 1);
    const ao = this.ao.configuration;
    // Contact shadow in corners and under counters, about a hand's width, never a dark halo.
    ao.aoRadius = 0.6;
    ao.distanceFalloff = 0.4;
    ao.intensity = 2.2;
    ao.color = new Color('#2a1208');
    ao.halfRes = true;
    ao.depthAwareUpsampling = true;
    this.ao.setQualityMode('Medium');
    this.composer.addPass(this.ao);

    // The arm: depth cleared, color kept, so it draws over the world.
    this.arm = new RenderPass(overlay, camera);
    this.arm.clearPass.color = false;
    this.arm.clearPass.depth = true;
    this.composer.addPass(this.arm);

    const bloom = new BloomEffect({
      mipmapBlur: true,
      intensity: 1.15,
      luminanceThreshold: 0.78,
      luminanceSmoothing: 0.3,
      radius: 0.76,
    });
    const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.AGX });
    const vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
    const grain = new NoiseEffect({ premultiply: true, blendFunction: BlendFunction.SCREEN });
    grain.blendMode.opacity.value = 0.05;
    const grade = new GradeEffect();
    this.composer.addPass(new EffectPass(camera, bloom, toneMapping, grade, vignette, grain));
  }

  /** Antialiasing samples and ambient occlusion, as the quality governor allows. */
  setQuality(msaa: number, ambientOcclusion: boolean): void {
    if (this.composer.multisampling !== msaa) this.composer.multisampling = msaa;
    this.ao.enabled = ambientOcclusion;
  }

  setSize(width: number, height: number): void {
    this.composer.setSize(width, height, false);
  }

  /** Draw a frame; `armShown` is whether the player's arm is in view. */
  render(dt: number, armShown: boolean): void {
    this.arm.enabled = armShown;
    this.composer.render(dt);
  }
}
