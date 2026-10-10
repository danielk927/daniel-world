import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  MeshStandardMaterial,
  type Texture,
} from 'three';
import { DEFAULT_LOOK, lookKey, type KnifeLook, type KnifeSkin } from '@world/shared';
import {
  FINISHES,
  finishTexture,
  finishUv,
  materialUv,
  paintFinish,
  paintMaterial,
  surfaceTexture,
  type Material,
} from './knifeFinishes.ts';
import { mergeNonIndexed, type KnifePart, type V2 } from './knifeShapes.ts';
import { knifeModel, type KnifeModel } from './knifeSkins.ts';
import { reflectProbe } from './surfaces/shading.ts';

/**
 * Knives as the renderer sees them: every model (knifeSkins.ts) painted in each of its finishes
 * (knifeFinishes.ts), as one vertex-colored geometry per look so every knife of a look in the world
 * is one draw call, and as separate parts for the hand on screen, whose knife can open and fold.
 * Geometries are built the first time a look is seen and shared after that; one material and two
 * small textures (color, and roughness with metalness) serve them all.
 *
 * Local space: the tip is at the origin and the knife lies along +Z, handle last, with the blade's
 * flat facing ±X and its edge down. So a knife whose blade points along `d` (tip first) is the model
 * turned from -Z onto `d`.
 */

export type { KnifeModel };
export { knifeModel };

/** Hardware that wears the finish (guards, rings, a butterfly's handles) is a shade darker. */
const METAL_SHADE = 0.86;

interface Bounds {
  z0: number;
  z1: number;
  y0: number;
  y1: number;
}

function bounds(geometries: readonly BufferGeometry[]): Bounds {
  const b = { z0: Infinity, z1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const g of geometries) {
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const z = p.getZ(i);
      b.z0 = Math.min(b.z0, z);
      b.z1 = Math.max(b.z1, z);
      b.y0 = Math.min(b.y0, y);
      b.y1 = Math.max(b.y1, y);
    }
  }
  return b;
}

const bladeBounds = new Map<KnifeSkin, Bounds>();

/** The extent of a knife's blade, which its finish is stretched over. */
function bladeExtent(model: KnifeModel): Bounds {
  let b = bladeBounds.get(model.skin);
  if (!b) {
    b = bounds(model.parts.filter((p) => p.kind === 'blade').map((p) => p.geometry));
    bladeBounds.set(model.skin, b);
  }
  return b;
}

/** A part's geometry with the look's finish laid on it: texture coordinates and vertex colors. */
function paint(model: KnifeModel, part: KnifePart, look: KnifeLook): BufferGeometry {
  const finish = FINISHES[look.finish];
  const source = part.geometry;
  const p = source.getAttribute('position');
  const uv = new Float32Array(p.count * 2);
  const color = new Float32Array(p.count * 3);
  const blade = bladeExtent(model);
  const length = Math.max(1e-6, blade.z1 - blade.z0);
  const height = Math.max(1e-6, blade.y1 - blade.y0);
  const own = part.kind === 'blade' ? blade : bounds([source]);
  const tint = new Color(
    part.kind === 'grip' ? (finish.grip ?? part.color ?? '#ffffff') : (part.color ?? '#ffffff'),
  );
  if (part.kind === 'metal') tint.setScalar(METAL_SHADE);
  if (part.kind === 'blade') tint.setScalar(1);
  // What a part that does not wear the finish is made of, laid on at its real size.
  const material: Material | null =
    part.kind === 'steel'
      ? 'steel'
      : part.kind === 'grip' || part.kind === 'accent'
        ? (part.material ?? 'g10')
        : null;
  if (material) paintMaterial(material);
  const at: [number, number] = [0, 0];
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    const z = p.getZ(i);
    if (part.kind === 'blade') {
      finishUv(look.finish, (z - blade.z0) / length, (y - blade.y0) / height, at);
    } else if (part.kind === 'metal') {
      // Hardware takes the finish as it is at the blade's base, running on away from the blade.
      finishUv(look.finish, 1 - (z - own.z0) / length, (y - own.y0) / height, at);
    } else {
      materialUv(material!, z - own.z0, y - own.y0, at);
    }
    uv[i * 2] = at[0];
    uv[i * 2 + 1] = at[1];
    color[i * 3] = tint.r;
    color[i * 3 + 1] = tint.g;
    color[i * 3 + 2] = tint.b;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', p);
  geometry.setAttribute('normal', source.getAttribute('normal'));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setAttribute('color', new Float32BufferAttribute(color, 3));
  return geometry;
}

const partGeometries = new Map<string, BufferGeometry>();
const lookGeometries = new Map<string, BufferGeometry>();

/** One part of a knife in a look, for the hand on screen, which moves its parts. */
export function knifePartGeometry(look: KnifeLook, part: KnifePart): BufferGeometry {
  const key = `${lookKey(look)}/${part.name}`;
  let geometry = partGeometries.get(key);
  if (!geometry) {
    paintFinish(look.finish);
    geometry = paint(knifeModel(look.skin), part, look);
    partGeometries.set(key, geometry);
  }
  return geometry;
}

/** A whole knife in a look, open and in one piece: every knife of that look in the world shares it. */
export function knifeGeometry(look: KnifeLook = DEFAULT_LOOK): BufferGeometry {
  const key = lookKey(look);
  let geometry = lookGeometries.get(key);
  if (!geometry) {
    const model = knifeModel(look.skin);
    const parts = model.parts.map((part) => knifePartGeometry(look, part));
    const merged = mergeNonIndexed(parts);
    const uv: number[] = [];
    const color: number[] = [];
    for (const g of parts) {
      uv.push(...(g.getAttribute('uv').array as Float32Array));
      color.push(...(g.getAttribute('color').array as Float32Array));
    }
    merged.setAttribute('uv', new Float32BufferAttribute(uv, 2));
    merged.setAttribute('color', new Float32BufferAttribute(color, 3));
    merged.computeBoundingSphere();
    geometry = merged;
    lookGeometries.set(key, geometry);
  }
  return geometry;
}

/**
 * How metal the steel is on the low tier, which has no probe to reflect: fully metal, it would
 * reflect nothing and go black, so it stays partly metal, lit by the lamps.
 */
const LOW_TIER_METAL = 0.4;

/**
 * A material for knives: smooth, each texel's color, roughness and metalness from the shared
 * textures (or copies of them, for a renderer of its own), its paint from the vertex colors.
 */
export function createKnifeMaterial(
  map: Texture = finishTexture(),
  surface: Texture = surfaceTexture(),
): MeshStandardMaterial {
  return new MeshStandardMaterial({
    vertexColors: true,
    map,
    roughnessMap: surface,
    metalnessMap: surface,
    roughness: 1,
    metalness: LOW_TIER_METAL,
    envMapIntensity: 1,
  });
}

let material: MeshStandardMaterial | null = null;

/** The one material every knife in the kitchen shares, whatever its look. */
export function knifeMaterial(): MeshStandardMaterial {
  return (material ??= createKnifeMaterial());
}

/**
 * The knives on the high tier: fully metal steel reflecting the kitchen's probe as its own steel
 * does, at full strength and box-projected, taking little light from it. three.js honours a
 * material's own reflection strength only with an `envMap` of its own: on the scene's faint
 * environment instead, every blade reflected next to nothing.
 */
export function dressKnives(probe: Texture): void {
  for (const knife of [knifeMaterial(), handKnifeMaterial()]) {
    knife.envMap = probe;
    knife.metalness = 1;
    reflectProbe(knife, 'knife');
    knife.needsUpdate = true;
  }
  handKnifeMaterial().envMapIntensity = HAND_REFLECTION;
}

/**
 * How brightly the knife in the player's own hand reflects the room. The arm on screen is lit by
 * lights of its own, a little brighter than the room round it so the hand reads; steel takes no
 * light from them but where they glint, so it reflects the room as much brighter to match.
 */
const HAND_REFLECTION = 1.6;

let handMaterial: MeshStandardMaterial | undefined;

/**
 * The knife in the player's own hand: the same steel, but a material of its own. The view model is
 * drawn in its own scene with its own lights; sharing one material with the instanced knives in the
 * kitchen made three.js switch its program back and forth, re-deriving its shader parameters twice
 * a frame (megabytes of garbage a second).
 */
export function handKnifeMaterial(): MeshStandardMaterial {
  return (handMaterial ??= knifeMaterial().clone());
}

/** Where a hand holds a knife, in its model space. */
export function knifeGrip(skin: KnifeSkin): V2 {
  return knifeModel(skin).grip;
}

/** The middle a knife tumbles about in flight, in its model space. */
export function knifeCenter(skin: KnifeSkin): V2 {
  return knifeModel(skin).center;
}

/**
 * A knife's silhouette in side view, as SVG paths (one per part, holes cut with even-odd) in a box
 * that fits it, tip to the left and spine up.
 */
export function knifeSilhouette(skin: KnifeSkin): { viewBox: string; paths: string[] } {
  const model = knifeModel(skin);
  let z0 = Infinity;
  let z1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const part of model.parts) {
    for (const loop of part.outline) {
      for (const [z, y] of loop.points) {
        z0 = Math.min(z0, z);
        z1 = Math.max(z1, z);
        y0 = Math.min(y0, y);
        y1 = Math.max(y1, y);
      }
    }
  }
  // Millimetres, y flipped so the spine is up.
  const mm = (n: number): string => (n * 1000).toFixed(1);
  const paths = model.parts.map((part) =>
    part.outline
      .map((loop) => `M${loop.points.map(([z, y]) => `${mm(z)} ${mm(-y)}`).join('L')}Z`)
      .join(''),
  );
  const pad = 0.004;
  const viewBox = [z0 - pad, -(y1 + pad), z1 - z0 + pad * 2, y1 - y0 + pad * 2].map(mm).join(' ');
  return { viewBox, paths };
}
