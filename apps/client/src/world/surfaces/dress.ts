import { MeshStandardMaterial, type Material, type Texture, type WebGLRenderer } from 'three';
import type { LayerName } from '../kit.ts';
import { paintFloorShade } from './floorShade.ts';
import { TexturePainter, type Recipe } from './painter.ts';
import {
  BAFFLE,
  BRASS,
  BRUSHED_STEEL,
  BUTCHER_BLOCK,
  CAST_IRON,
  CLOTH,
  COPPER,
  FLOOR,
  FOOD,
  PLASTER,
  STONE,
  WALL_TILE,
} from './recipes.ts';
import { floorUniforms } from './shading.ts';

/** Which recipe paints each layer. Glazes, glass and the glowing layers have none. */
export const LAYER_RECIPES: Partial<Record<LayerName, Recipe>> = {
  floor: FLOOR,
  tile: WALL_TILE,
  shell: PLASTER,
  steel: BRUSHED_STEEL,
  baffle: BAFFLE,
  iron: CAST_IRON,
  copper: COPPER,
  brass: BRASS,
  stone: STONE,
  wood: BUTCHER_BLOCK,
  matte: CLOTH,
  food: FOOD,
};

/** Layers that do not reflect the room: they glow, or are lit by their own baked light. */
const UNREFLECTIVE: readonly LayerName[] = ['window', 'light', 'cold', 'exit'];

/**
 * Dress the kitchen for the high tier: paint each layer's textures on the GPU and give every lit
 * layer the kitchen's reflection probe. Before the shaders compile, so they are compiled once, as
 * they will be drawn.
 */
export function dressKitchen(
  materials: Record<LayerName, Material>,
  renderer: WebGLRenderer,
  reflections: Texture,
): void {
  const painter = new TexturePainter(renderer);
  floorUniforms.floorShade.value = paintFloorShade(renderer);
  for (const [layer, material] of Object.entries(materials) as [LayerName, Material][]) {
    if (!(material instanceof MeshStandardMaterial)) continue;
    const recipe = LAYER_RECIPES[layer];
    if (recipe) {
      const { map, normalRoughness } = painter.paint(recipe);
      if (map) material.map = map;
      material.normalMap = normalRoughness;
      // The painted roughness is the roughness; the part's finish still scales it.
      material.roughness = 1;
    }
    if (!UNREFLECTIVE.includes(layer)) {
      // Its own envMap, so its envMapIntensity counts (three.js ignores it for scene.environment).
      material.envMap = reflections;
      material.envMapIntensity = 1;
    }
    material.needsUpdate = true;
  }
  painter.dispose();
}
