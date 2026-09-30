/** Three.js needs WebGL 2. Checked once, before we try to build the world. */
export function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2');
    if (!gl) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Phones and tablets without a mouse. They get pointed at the portfolio page. */
export function isTouchOnly(): boolean {
  return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}
