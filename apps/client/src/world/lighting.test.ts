import { Light, Scene, SpotLight, Vector3, type WebGLRenderer } from 'three';
import { describe, expect, it } from 'vitest';
import { createLightCones } from './effects.ts';
import { createLighting } from './lighting.ts';

describe('the low quality lighting', () => {
  it('is cheap enough for a software renderer: no shadows and no practical lights', () => {
    const scene = new Scene();
    // The low tier never touches the renderer (no environment map to prefilter).
    createLighting(scene, null as unknown as WebGLRenderer, 'low');
    const lights: Light[] = [];
    scene.traverse((o) => {
      if (o instanceof Light) lights.push(o);
    });
    expect(lights.length).toBeLessThanOrEqual(3);
    expect(lights.some((l) => l.castShadow)).toBe(false);
    expect(lights.some((l) => l instanceof SpotLight)).toBe(false);
    expect(scene.environment).toBeNull();
    expect(scene.fog).not.toBeNull();
  });
});

describe('the light beams', () => {
  it('runs every beam from 0 at the lamp to 1 at its end, so the shader never sees past them', () => {
    const mesh = createLightCones([
      { apex: new Vector3(0, 2, 4.3), height: 1, radius: 0.4, color: '#ff9447' },
      { apex: new Vector3(-3, 2.9, -4.2), height: 2, radius: 0.8, color: '#ffd6a6' },
    ]);
    const along = mesh.geometry.getAttribute('aAlong');
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < along.count; i++) {
      min = Math.min(min, along.getX(i));
      max = Math.max(max, along.getX(i));
    }
    expect(min).toBeCloseTo(0, 6);
    expect(max).toBeCloseTo(1, 6);
    // One mesh for every beam: one draw call.
    expect(mesh.isMesh).toBe(true);
  });
});
