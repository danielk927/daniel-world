import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  LatheGeometry,
  Matrix4,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Quaternion,
  SphereGeometry,
  TorusGeometry,
  Vector2,
  Vector3,
  Color,
  type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { ShadeOutline } from '@world/shared';
import { StaticBuilder, at, type LayerOptions, type PartOptions } from './builder.ts';
import { shadeSurface, type Shading } from './surfaces/shading.ts';
import { everySecondCountsTexture, exitSignTexture } from './textures.ts';

/** Layers of the static kitchen. Each becomes one mesh (one draw call). */
export type LayerName =
  | 'floor'
  | 'tile'
  | 'shell'
  | 'matte'
  | 'gloss'
  | 'steel'
  | 'iron'
  | 'brass'
  | 'copper'
  | 'stone'
  | 'wood'
  | 'food'
  | 'glass'
  | 'window'
  | 'light'
  | 'cold'
  | 'sign'
  | 'exit';

/** Named colors for the painted layers. */
export const paint = {
  // After the French Laundry: white walls and vault, pale stone floor, stainless, charcoal tops.
  floor: '#a5a199',
  wall: '#f4f2ec',
  vault: '#f5f3ee',
  cabinet: '#f1f1ee',
  charcoal: '#3a3c3f',
  marble: '#f3f0ea',
  windowFrame: '#3c3f43',
  plaque: '#fbfbf8',
  filter: '#c9cdd0',
  seam: '#9da6ad',
  rail: '#141414',
  ovenDoor: '#bcc4cb',
  wood: '#b0754a',
  woodLight: '#f2dcc2',
  porcelain: '#f6f3ec',
  ticket: '#fbf8f0',
  rubber: '#1d1b1a',
  cream: '#efe0c4',
  lamp: '#fff4df',
  bulb: '#ff8a47',
  porthole: '#ffc98c',
} as const;

export interface Burner {
  readonly position: Vector3;
  readonly radius: number;
}

export interface SteamSource {
  readonly position: Vector3;
  readonly strength: number;
}

const glow = (scale: number): Color => new Color(scale, scale, scale);

const unitBox = new BoxGeometry(1, 1, 1);

/**
 * Sides for a round thing of this radius: enough that a facet never strays from the true circle by
 * more than `sagitta` meters (so it reads round from a meter away), and no more. A caller can ask
 * for fewer, never more.
 */
export function roundSides(radius: number, requested = Infinity, sagitta = 0.0006): number {
  const ideal = Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - sagitta / Math.max(radius, 1e-4))));
  const sides = Math.max(8, Math.min(64, ideal));
  return Math.max(3, Math.min(requested, sides));
}

const cylinders = new Map<string, CylinderGeometry>();
const spheres = new Map<number, SphereGeometry>();

/**
 * A lamp shade turned from its outline (shared, so knives stick where it is drawn): down the outside
 * from the top to the rim and back up the inside, a thin wall that reads from above and below.
 */
export function shadeGeometry(outline: ShadeOutline, segments: number): LatheGeometry {
  const outside = [...outline.outside].reverse();
  const inside = outline.inside;
  const profile = [
    [0.001, outside[0]![1]],
    ...outside,
    ...inside,
    [0.001, inside[inside.length - 1]![1]],
  ];
  return new LatheGeometry(
    profile.map(([radius, y]) => new Vector2(radius, y)),
    segments,
  );
}

function unitCylinder(segments: number, topScale: number, open: boolean): CylinderGeometry {
  const key = `${segments}:${topScale}:${open}`;
  let geometry = cylinders.get(key);
  if (!geometry) {
    // Base at y = 0, so a cylinder is placed by where it stands.
    geometry = new CylinderGeometry(topScale, 1, 1, segments, 1, open);
    geometry.translate(0, 0.5, 0);
    cylinders.set(key, geometry);
  }
  return geometry;
}

function unitSphere(segments: number): SphereGeometry {
  let geometry = spheres.get(segments);
  if (!geometry) {
    geometry = new SphereGeometry(1, segments, Math.max(4, Math.round(segments / 2)));
    spheres.set(segments, geometry);
  }
  return geometry;
}

/**
 * A copy of a cylinder with its texture coordinates in meters: the side unrolled to its
 * circumference and height, the caps laid flat across their diameter.
 */
function metricCylinder(
  geometry: CylinderGeometry,
  radius: number,
  height: number,
  taper: number,
): BufferGeometry {
  const copy = geometry.clone();
  const uv = copy.getAttribute('uv');
  const around = Math.PI * radius * (1 + taper);
  for (const group of copy.groups) {
    const index = copy.index!;
    const cap = group.materialIndex;
    const [su, sv] =
      cap === 0
        ? [around, height]
        : cap === 1
          ? [2 * radius * taper, 2 * radius * taper]
          : [2 * radius, 2 * radius];
    const seen = new Set<number>();
    for (let i = group.start; i < group.start + group.count; i++) {
      const v = index.getX(i);
      if (seen.has(v)) continue;
      seen.add(v);
      uv.setXY(v, uv.getX(v) * su, uv.getY(v) * sv);
    }
  }
  return copy;
}

/** A copy of `geometry` with its own texture coordinates scaled to meters. */
function scaledUvs(geometry: BufferGeometry, su: number, sv: number): BufferGeometry {
  const copy = geometry.clone();
  const uv = copy.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
  return copy;
}

export interface CylinderOptions {
  readonly segments?: number;
  /** Top radius as a fraction of the bottom radius. */
  readonly taper?: number;
  readonly open?: boolean;
  readonly rx?: number;
  readonly rz?: number;
  readonly ry?: number;
  /** Stretch along Z, for oval pans. */
  readonly depthScale?: number;
  readonly color?: string;
  readonly finish?: number;
}

/** A material and how its layer is drawn. */
interface Surface {
  readonly material: Material;
  readonly options: LayerOptions;
  readonly shading?: Shading;
}

/**
 * The kitchen's materials. Both tiers draw the same geometry, smooth-shaded, with the same paint;
 * the high tier's are physically based metals and glazes, which get painted textures and the
 * kitchen's reflections when the world is built (see surfaces/), while the low tier's have neither,
 * so its metals keep some color of their own instead of reflecting nothing.
 */
function surfaces(hdr: boolean): Record<LayerName, Surface> {
  const painted = (roughness: number, extra: Partial<LayerOptions> = {}): Surface => ({
    material: new MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0 }),
    options: { vertexColors: true, ...extra },
  });
  const finished = (roughness: number, extra: Partial<LayerOptions> = {}): Surface => ({
    ...painted(roughness, extra),
    options: { vertexColors: true, finish: true, ...extra },
    shading: { finish: true },
  });
  // A metal's color is what it reflects; with nothing to reflect, the low tier's metals are only
  // partly metal and keep the deeper color of the old flat look.
  const metal = (
    reflects: string,
    flat: string,
    roughness: number,
    options: LayerOptions,
  ): Surface => ({
    material: new MeshStandardMaterial({
      color: hdr ? reflects : flat,
      roughness,
      metalness: hdr ? 1 : 0.75,
    }),
    options,
  });
  return {
    floor: {
      ...painted(0.42),
      shading: {
        tiles: { size: [0.5, 0.5], bond: false, color: 0.035, roughness: 0.12 },
      },
    },
    tile: {
      ...painted(0.12),
      shading: {
        tiles: { size: [0.6, 0.3], bond: false, color: 0.015, roughness: 0.2 },
      },
    },
    // The room's shell (ceiling, upper walls, ceiling fixtures) never casts shadows: the overhead
    // light sits above the ceiling, which would otherwise shadow the whole room.
    shell: painted(0.88),
    matte: finished(0.85, { castShadow: true }),
    gloss: finished(0.12, { castShadow: true }),
    steel: {
      material: hdr
        ? new MeshPhysicalMaterial({
            color: '#b4b7b8',
            metalness: 1,
            roughness: 0.32,
            // Brushed: the highlights stretch across the grain, along u (see the builder).
            anisotropy: 0.5,
          })
        : new MeshStandardMaterial({ color: '#cfd3d4', metalness: 0.55, roughness: 0.34 }),
      options: { castShadow: true },
    },
    iron: {
      material: new MeshStandardMaterial({
        color: '#3d3a38',
        metalness: hdr ? 0.45 : 0.3,
        roughness: 0.6,
      }),
      options: { castShadow: true },
    },
    // Brass and copper are small polished pieces; shadows would only turn them maroon and olive.
    brass: metal('#e9cf8d', '#e0b052', 0.3, { castShadow: true, receiveShadow: false }),
    copper: metal('#f0a487', '#d9774a', 0.24, { castShadow: true, receiveShadow: false }),
    stone: finished(0.45, { castShadow: true }),
    wood: finished(0.55, { castShadow: true }),
    food: finished(0.6, { castShadow: true }),
    glass: {
      // Clear glass and plastic: tumblers, the cloche, tubs, the fridge door. Front faces only,
      // so a glass never draws its far side over its near side.
      material: new MeshStandardMaterial({
        color: '#e4ecef',
        roughness: 0.06,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
      }),
      options: { receiveShadow: false },
    },
    window: {
      // Night glass: a dark tint, unlit. Smooth lit glass would catch the kitchen's lamps as soft
      // highlights smeared across the view outside.
      material: new MeshBasicMaterial({
        color: '#16202c',
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        side: DoubleSide,
        // Flat panes need no back-then-front pass. Two passes made three.js flip the material's
        // side and re-derive its shader parameters four times a frame (megabytes of garbage).
        forceSinglePass: true,
      }),
      // Before the clear glass, so a tumbler seen against a window is not tinted as if behind it.
      options: { receiveShadow: false, renderOrder: -1 },
    },
    light: {
      material: new MeshBasicMaterial({ vertexColors: true, color: glow(hdr ? 2.2 : 1) }),
      options: { vertexColors: true, receiveShadow: false },
    },
    // The walk-in cooler's inside: lit by its own lamps, baked into its colors, out of the
    // kitchen's light (see cooler.ts).
    cold: {
      material: new MeshBasicMaterial({ vertexColors: true }),
      options: { vertexColors: true, receiveShadow: false },
    },
    sign: {
      material: new MeshStandardMaterial({ map: everySecondCountsTexture(), roughness: 0.9 }),
      options: {},
    },
    exit: {
      material: new MeshBasicMaterial({ map: exitSignTexture() }),
      options: { receiveShadow: false },
    },
  };
}

/**
 * Everything needed to build the kitchen: the merging builder, its materials, geometry helpers in
 * world units, and the lists of burners and steam sources that the animated effects read.
 */
export class Kit {
  readonly builder = new StaticBuilder();
  readonly burners: Burner[] = [];
  readonly steam: SteamSource[] = [];
  /** Each layer's material, for the world to paint and give reflections. */
  readonly materials = {} as Record<LayerName, Material>;
  /** How far a round thing's facets may stray from its true circle, in meters. */
  private readonly sagitta: number;

  /**
   * `hdr`: the high tier, where lamps and glowing things shine brighter than white for the bloom to
   * catch, and metals are physically based.
   */
  constructor(hdr = false) {
    this.sagitta = hdr ? 0.0006 : 0.0025;
    for (const [name, surface] of Object.entries(surfaces(hdr)) as [LayerName, Surface][]) {
      if (surface.material instanceof MeshStandardMaterial) {
        shadeSurface(surface.material, surface.shading);
      }
      this.builder.layer(name, surface.material, surface.options);
      this.materials[name] = surface.material;
    }
  }

  /** Sides for something round of this radius, at this tier's detail. */
  sides(radius: number, requested?: number): number {
    return roundSides(radius, requested, this.sagitta);
  }

  add(
    layer: LayerName,
    geometry: BufferGeometry,
    matrix?: Matrix4,
    color?: string | Color,
    options?: PartOptions,
  ): void {
    this.builder.add(layer, geometry, matrix, color, options);
  }

  /** Axis-aligned box by its extents. */
  box(
    layer: LayerName,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
    minZ: number,
    maxZ: number,
    color?: string,
    finish?: number,
  ): void {
    this.add(
      layer,
      unitBox,
      at((minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2, {
        sx: maxX - minX,
        sy: maxY - minY,
        sz: maxZ - minZ,
      }),
      color,
      { finish },
    );
  }

  /** Box centered on (x, y, z), turned by `ry`. */
  boxAt(
    layer: LayerName,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    options: { ry?: number; rx?: number; rz?: number; color?: string; finish?: number } = {},
  ): void {
    this.add(
      layer,
      unitBox,
      at(x, y, z, { ry: options.ry, rx: options.rx, rz: options.rz, sx: w, sy: h, sz: d }),
      options.color,
      { finish: options.finish },
    );
  }

  /**
   * Box with rounded edges, centered on (x, y, z): its faces stay where a box's would be, and the
   * edges roll round over `radius`, smooth-shaded, so they catch the light as a real edge does.
   */
  rounded(
    layer: LayerName,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    radius: number,
    color?: string,
    options: { ry?: number; finish?: number } = {},
  ): void {
    this.add(
      layer,
      new RoundedBoxGeometry(w, h, d, 2, radius),
      at(x, y, z, { ry: options.ry }),
      color,
      { finish: options.finish },
    );
  }

  /** Cylinder standing on (x, y, z). */
  cylinder(
    layer: LayerName,
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number,
    options: CylinderOptions = {},
  ): void {
    const taper = options.taper ?? 1;
    const reach = radius * Math.max(1, taper) * Math.max(1, options.depthScale ?? 1);
    const sides = this.sides(reach, options.segments);
    const geometry = metricCylinder(
      unitCylinder(sides, taper, options.open ?? false),
      radius,
      height,
      taper,
    );
    this.add(
      layer,
      geometry,
      at(x, y, z, {
        rx: options.rx,
        ry: options.ry,
        rz: options.rz,
        sx: radius,
        sy: height,
        sz: radius * (options.depthScale ?? 1),
      }),
      options.color,
      { uv: 'own', finish: options.finish },
    );
  }

  /** A rod between two points. */
  rod(layer: LayerName, from: Vector3, to: Vector3, radius: number, segments?: number): void {
    const length = from.distanceTo(to);
    const geometry = new CylinderGeometry(
      radius,
      radius,
      length,
      this.sides(radius, segments),
      1,
      false,
    );
    geometry.translate(0, length / 2, 0);
    // Turn +Y onto the rod direction.
    const direction = new Vector3().subVectors(to, from).normalize();
    const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction);
    const matrix = new Matrix4().compose(from, rotation, new Vector3(1, 1, 1));
    this.add(layer, scaledUvs(geometry, 2 * Math.PI * radius, length), matrix, undefined, {
      uv: 'own',
    });
  }

  sphere(
    layer: LayerName,
    x: number,
    y: number,
    z: number,
    radius: number,
    options: {
      sx?: number;
      sy?: number;
      sz?: number;
      ry?: number;
      rx?: number;
      rz?: number;
      color?: string | Color;
      finish?: number;
      segments?: number;
    } = {},
  ): void {
    const reach = radius * Math.max(options.sx ?? 1, options.sy ?? 1, options.sz ?? 1);
    const geometry = scaledUvs(
      unitSphere(this.sides(reach, options.segments)),
      2 * Math.PI * reach,
      Math.PI * reach,
    );
    this.add(
      layer,
      geometry,
      at(x, y, z, {
        rx: options.rx,
        ry: options.ry,
        rz: options.rz,
        sx: radius * (options.sx ?? 1),
        sy: radius * (options.sy ?? 1),
        sz: radius * (options.sz ?? 1),
      }),
      options.color,
      { uv: 'own', finish: options.finish },
    );
  }

  /** A flat ring lying on a surface at height y. */
  ring(layer: LayerName, x: number, y: number, z: number, radius: number, tube: number): void {
    this.add(layer, this.torus(radius, tube), at(x, y, z, { rx: Math.PI / 2 }), undefined, {
      uv: 'own',
    });
  }

  /** A torus (or part of one) of this radius and tube, round enough at this tier, in meters. */
  torus(radius: number, tube: number, arc = Math.PI * 2): BufferGeometry {
    const geometry = new TorusGeometry(
      radius,
      tube,
      this.sides(tube, 12),
      Math.max(6, Math.round((this.sides(radius) * arc) / (Math.PI * 2))),
      arc,
    );
    return scaledUvs(geometry, arc * radius, 2 * Math.PI * tube);
  }

  /**
   * Something turned on a lathe from a profile of (radius, height) points, bottom to top along the
   * outside and back down the inside, standing on (x, y, z).
   */
  lathe(
    layer: LayerName,
    x: number,
    y: number,
    z: number,
    profile: readonly (readonly [number, number])[],
    options: { color?: string; finish?: number; ry?: number; depthScale?: number } = {},
  ): void {
    const widest = Math.max(...profile.map(([r]) => r));
    const geometry = new LatheGeometry(
      profile.map(([r, h]) => new Vector2(r, h)),
      this.sides(widest * Math.max(1, options.depthScale ?? 1)),
    );
    let length = 0;
    for (let i = 1; i < profile.length; i++) {
      length += Math.hypot(
        profile[i]![0] - profile[i - 1]![0],
        profile[i]![1] - profile[i - 1]![1],
      );
    }
    this.add(
      layer,
      scaledUvs(geometry, 2 * Math.PI * widest, length),
      at(x, y, z, { ry: options.ry, sz: options.depthScale }),
      options.color,
      { uv: 'own', finish: options.finish },
    );
  }

  /** A vertical wall quad from (x0, z0) to (x1, z1), facing `normal`. */
  wall(
    layer: LayerName,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y0: number,
    y1: number,
    normal: Vector3,
    color?: string,
  ): void {
    const positions = [x0, y0, z0, x1, y0, z1, x1, y1, z1, x0, y1, z0];
    // Pick the winding whose face normal matches the requested one.
    const edge = new Vector3(x1 - x0, 0, z1 - z0);
    const facing = new Vector3().crossVectors(edge, new Vector3(0, 1, 0)).dot(normal);
    const order = facing > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setIndex(order);
    geometry.computeVertexNormals();
    this.add(layer, geometry, undefined, color);
  }

  /** Any flat four-cornered face, wound so it faces `normal`. Corners go around the edge in order. */
  quad(layer: LayerName, corners: readonly Vector3[], normal: Vector3, color?: string): void {
    const [a, b, c] = corners as [Vector3, Vector3, Vector3, Vector3];
    const facing = new Vector3()
      .crossVectors(new Vector3().subVectors(b, a), new Vector3().subVectors(c, a))
      .dot(normal);
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      'position',
      new Float32BufferAttribute(
        corners.flatMap((p) => [p.x, p.y, p.z]),
        3,
      ),
    );
    geometry.setIndex(facing > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
    geometry.computeVertexNormals();
    this.add(layer, geometry, undefined, color);
  }

  /** A horizontal quad (floor, ceiling, a tile) facing up or down. */
  flat(
    layer: LayerName,
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
    y: number,
    up: boolean,
    color?: string,
  ): void {
    const positions = [minX, y, minZ, maxX, y, minZ, maxX, y, maxZ, minX, y, maxZ];
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    geometry.setIndex(up ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3]);
    geometry.computeVertexNormals();
    this.add(layer, geometry, undefined, color);
  }

  burner(x: number, y: number, z: number, radius: number): void {
    this.burners.push({ position: new Vector3(x, y, z), radius });
  }

  steamFrom(x: number, y: number, z: number, strength = 1): void {
    this.steam.push({ position: new Vector3(x, y, z), strength });
  }
}
