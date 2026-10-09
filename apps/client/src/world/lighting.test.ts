import { Color, Light, Scene, SpotLight, Vector3, type WebGLRenderer } from 'three';
import type * as Three from 'three';
import { describe, expect, it, vi } from 'vitest';
import { PASS_DISHES } from '@world/shared';
import { createLightCones } from './effects.ts';
import { createLighting } from './lighting.ts';

// Prefiltering the environment needs a GPU; the lights themselves do not.
vi.mock('three', async (importOriginal) => {
  const three = await importOriginal<typeof Three>();
  class PMREMGenerator {
    fromScene(): { texture: null } {
      return { texture: null };
    }
    dispose(): void {}
  }
  return { ...three, PMREMGenerator };
});

function lightsIn(scene: Scene): Light[] {
  const lights: Light[] = [];
  scene.traverse((o) => {
    if (o instanceof Light) lights.push(o);
  });
  return lights;
}

describe('the low quality lighting', () => {
  it('is cheap enough for a software renderer: no shadows and no practical lights', () => {
    const scene = new Scene();
    // The low tier never touches the renderer (no environment map to prefilter).
    createLighting(scene, null as unknown as WebGLRenderer, 'low');
    const lights = lightsIn(scene);
    expect(lights.length).toBeLessThanOrEqual(3);
    expect(lights.some((l) => l.castShadow)).toBe(false);
    expect(lights.some((l) => l instanceof SpotLight)).toBe(false);
    expect(scene.environment).toBeNull();
    expect(scene.fog).not.toBeNull();
  });
});

describe('the high quality lighting', () => {
  it('lights every dish on the pass with a heat lamp, inside the bright core of its pool', () => {
    const scene = new Scene();
    createLighting(scene, null as unknown as WebGLRenderer, 'high');
    const amber = new Color('#ff9447').getHex();
    const heat = lightsIn(scene).filter(
      (l): l is SpotLight => l instanceof SpotLight && l.color.getHex() === amber,
    );
    const axis = new Vector3();
    const toDish = new Vector3();
    for (const dish of PASS_DISHES) {
      const lit = heat.some((lamp) => {
        axis.subVectors(lamp.target.position, lamp.position).normalize();
        toDish.set(dish.x, dish.y, dish.z).sub(lamp.position);
        const inReach = toDish.length() < lamp.distance;
        // Inside the penumbra a spot fades out; inside this angle it shines at full strength.
        const core = Math.cos(lamp.angle * (1 - lamp.penumbra));
        return inReach && axis.dot(toDish.normalize()) >= core;
      });
      expect(lit, dish.id).toBe(true);
    }
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
