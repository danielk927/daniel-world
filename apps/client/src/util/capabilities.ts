export type Quality = 'high' | 'low';

export interface WebGLProbe {
  /** Three.js needs WebGL 2. */
  supported: boolean;
  /** Rendering on the CPU (no GPU, VMs, some remote desktops). */
  software: boolean;
}

/** Checked once, before we try to build the world. */
export function probeWebGL(): WebGLProbe {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return { supported: false, software: false };
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const renderer = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : '';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return {
      supported: true,
      software: /swiftshader|llvmpipe|softpipe|software|basic render/i.test(renderer),
    };
  } catch {
    return { supported: false, software: false };
  }
}

/**
 * High quality unless the GPU is a software renderer, where shadows and full resolution would make
 * the world unplayable. `?quality=high` or `?quality=low` overrides the choice.
 */
export function pickQuality(probe: WebGLProbe): Quality {
  const forced = new URLSearchParams(location.search).get('quality');
  if (forced === 'high' || forced === 'low') return forced;
  return probe.software ? 'low' : 'high';
}

/** Phones and tablets without a mouse. They get pointed at the portfolio page. */
export function isTouchOnly(): boolean {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}
