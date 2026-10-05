import type { BufferGeometry } from 'three';
import { BoxGeometry, Color, Float32BufferAttribute, MeshStandardMaterial } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * A chef's knife, low-poly like the kitchen: a steel blade tapering to its tip, a bolster and a dark
 * handle, merged into one vertex-colored geometry so every knife in the world is one draw call.
 *
 * Local space: the tip is at the origin and the knife lies along +Z, handle last, with the blade's
 * flat facing ±X and its edge down. So a knife whose blade points along `d` (tip first) is the model
 * turned from -Z onto `d`.
 */

export const BLADE_LENGTH = 0.19;
export const HANDLE_LENGTH = 0.11;
export const KNIFE_LENGTH = BLADE_LENGTH + 0.015 + HANDLE_LENGTH;
/** Where a hand holds it, measured from the tip. */
export const GRIP = BLADE_LENGTH + 0.015 + HANDLE_LENGTH * 0.5;
/** The middle of the knife, which it tumbles around in flight. */
export const KNIFE_CENTER = KNIFE_LENGTH * 0.45;

const STEEL = '#d5dbe0';
const BOLSTER = '#9aa3ab';
const HANDLE = '#3a2a21';

function painted(geometry: BufferGeometry, color: string): BufferGeometry {
  const c = new Color(color);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) colors.set([c.r, c.g, c.b], i * 3);
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

function buildKnife(): BufferGeometry {
  // The blade: a thin wedge, full height at the bolster, running to a point at the tip.
  const blade = new BoxGeometry(0.006, 0.042, BLADE_LENGTH, 1, 1, 1);
  const position = blade.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const z = position.getZ(i);
    const y = position.getY(i);
    if (z < 0) {
      // The tip end: the spine sweeps down to meet the edge.
      position.setY(i, y > 0 ? -0.012 : -0.021);
      position.setX(i, position.getX(i) * 0.4);
    }
  }
  blade.translate(0, 0, BLADE_LENGTH / 2);
  blade.computeVertexNormals();
  const bolster = new BoxGeometry(0.014, 0.048, 0.015);
  bolster.translate(0, 0.002, BLADE_LENGTH + 0.0075);
  const handle = new BoxGeometry(0.02, 0.028, HANDLE_LENGTH);
  handle.translate(0, 0.004, BLADE_LENGTH + 0.015 + HANDLE_LENGTH / 2);
  const merged = mergeGeometries([
    painted(blade.toNonIndexed(), STEEL),
    painted(bolster.toNonIndexed(), BOLSTER),
    painted(handle.toNonIndexed(), HANDLE),
  ]);
  if (!merged) throw new Error('Could not build the knife');
  return merged;
}

let geometry: BufferGeometry | null = null;
let material: MeshStandardMaterial | null = null;

/** The one knife geometry, shared by every knife in the world, in hands and on screen. */
export function knifeGeometry(): BufferGeometry {
  return (geometry ??= buildKnife());
}

/** The one knife material: faceted, with a little sheen on the steel. */
export function knifeMaterial(): MeshStandardMaterial {
  return (material ??= new MeshStandardMaterial({
    vertexColors: true,
    flatShading: true,
    metalness: 0.35,
    roughness: 0.45,
    // Steel shows the kitchen in it, like the counters (see the environment in lighting.ts).
    envMapIntensity: 10,
  }));
}
