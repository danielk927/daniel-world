import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  MeshBasicMaterial,
  Matrix4,
  MeshStandardMaterial,
  Quaternion,
  IcosahedronGeometry,
  TorusGeometry,
  Vector3,
  Color,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { StaticBuilder, at } from './builder.ts';
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
  | 'marble'
  | 'glass'
  | 'window'
  | 'light'
  | 'outside'
  | 'sign'
  | 'exit';

/** Named colors for the painted layers. */
export const paint = {
  // After the French Laundry: white vaults and walls, pale grey floor, stainless, charcoal tops.
  floor: '#9ea3a6',
  grout: '#868b8e',
  wall: '#f4f4f1',
  vault: '#f7f7f4',
  cabinet: '#f1f1ee',
  charcoal: '#34373b',
  windowFrame: '#3c3f43',
  plaque: '#fbfbf8',
  filter: '#dfe3e6',
  seam: '#9da6ad',
  rail: '#141414',
  ovenDoor: '#bcc4cb',
  wood: '#8a5a35',
  woodLight: '#b98a5a',
  porcelain: '#f6f3ec',
  ticket: '#fbf8f0',
  rubber: '#1d1b1a',
  cream: '#efe0c4',
  lamp: '#fff4df',
  bulb: '#ff8a47',
  porthole: '#ffc98c',
  walkInDisplay: '#ff4d3d',
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
/** Faceted spheres: an icosphere for anything sizable, a bare icosahedron for small things. */
const unitSphere = new IcosahedronGeometry(1, 1);
const smallSphere = new IcosahedronGeometry(1, 0);

/**
 * Sides for a round thing of this radius: few enough that the facets show, enough that it still
 * reads as round. A caller can ask for fewer, never more.
 */
export function lowPolySides(radius: number, requested = Infinity): number {
  const sides = radius < 0.04 ? 6 : radius < 0.12 ? 8 : radius < 0.3 ? 10 : 12;
  return Math.max(3, Math.min(requested, sides));
}
const cylinders = new Map<string, CylinderGeometry>();

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
}

/**
 * Everything needed to build the kitchen: the merging builder, its materials, geometry helpers in
 * world units, and the lists of burners and steam sources that the animated effects read.
 */
export class Kit {
  readonly builder = new StaticBuilder();
  readonly burners: Burner[] = [];
  readonly steam: SteamSource[] = [];

  /** `hdr`: lamps and glowing things shine brighter than white, for the bloom to catch. */
  constructor(hdr = false) {
    // Low-poly look: every surface is flat-shaded, so each facet reads as one color. Painted
    // surfaces are matte; metals take soft reflections of the room, as on Ratatouille, where they
    // were kept soft so the steel reads as worked, not new.
    const standard = (params: ConstructorParameters<typeof MeshStandardMaterial>[0]) =>
      new MeshStandardMaterial({ flatShading: true, ...params });
    const painted = (roughness: number) =>
      standard({ vertexColors: true, roughness, metalness: 0 });
    this.builder
      .layer('floor', painted(0.85), { vertexColors: true })
      .layer('tile', painted(0.6), { vertexColors: true })
      // The room's shell (ceiling, upper walls, ceiling fixtures) never casts shadows: the overhead
      // light sits above the ceiling, which would otherwise shadow the whole room.
      .layer('shell', painted(0.9), { vertexColors: true })
      .layer('matte', painted(0.85), { castShadow: true, vertexColors: true })
      .layer('gloss', painted(0.45), { castShadow: true, vertexColors: true })
      .layer(
        'steel',
        standard({ color: '#cfd3d4', metalness: 0.55, roughness: 0.34, envMapIntensity: 12 }),
        { castShadow: true },
      )
      .layer(
        'iron',
        standard({ color: '#4c4846', metalness: 0.3, roughness: 0.62, envMapIntensity: 6 }),
        { castShadow: true },
      )
      // Brass and copper are small polished pieces; shadows would only turn them maroon and olive.
      .layer(
        'brass',
        standard({ color: '#e0b052', metalness: 0.75, roughness: 0.3, envMapIntensity: 14 }),
        { castShadow: true, receiveShadow: false },
      )
      .layer(
        'copper',
        standard({ color: '#d9774a', metalness: 0.75, roughness: 0.3, envMapIntensity: 14 }),
        { castShadow: true, receiveShadow: false },
      )
      .layer('marble', standard({ color: '#f2eee6', roughness: 0.55 }), { castShadow: true })
      .layer(
        'glass',
        // Clear glass and plastic: tumblers, the cloche, tubs, the fridge door. Front faces only,
        // so a glass never draws its far side over its near side.
        standard({
          color: '#e4ecef',
          roughness: 0.08,
          envMapIntensity: 8,
          transparent: true,
          opacity: 0.2,
          depthWrite: false,
        }),
        { receiveShadow: false },
      )
      .layer(
        'window',
        // Night glass: a dark tint, unlit. Smooth lit glass would catch the kitchen's lamps as
        // soft highlights smeared across the view outside.
        new MeshBasicMaterial({
          color: '#16202c',
          transparent: true,
          opacity: 0.22,
          depthWrite: false,
          side: DoubleSide,
        }),
        // Before the clear glass, so a tumbler seen against a window is not tinted as if behind it.
        { receiveShadow: false, renderOrder: -1 },
      )
      .layer('light', new MeshBasicMaterial({ vertexColors: true, color: glow(hdr ? 2.2 : 1) }), {
        vertexColors: true,
        receiveShadow: false,
      })
      // The view outside (see outside.ts): unlit, its dusk light and haze baked into its colors.
      .layer(
        'outside',
        new MeshBasicMaterial({ vertexColors: true, fog: false, toneMapped: false }),
        { vertexColors: true, receiveShadow: false },
      )
      .layer('sign', standard({ map: everySecondCountsTexture(), roughness: 0.9 }))
      .layer('exit', new MeshBasicMaterial({ map: exitSignTexture() }), { receiveShadow: false });
  }

  add(layer: LayerName, geometry: BufferGeometry, matrix?: Matrix4, color?: string | Color): void {
    this.builder.add(layer, geometry, matrix, color);
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
    options: { ry?: number; rx?: number; rz?: number; color?: string } = {},
  ): void {
    this.add(
      layer,
      unitBox,
      at(x, y, z, { ry: options.ry, rx: options.rx, rz: options.rz, sx: w, sy: h, sz: d }),
      options.color,
    );
  }

  /** Box with chamfered edges, centered on (x, y, z). The bevel catches light as its own facet. */
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
  ): void {
    this.add(layer, new RoundedBoxGeometry(w, h, d, 1, radius), at(x, y, z), color);
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
    const sides = lowPolySides(radius * Math.max(1, options.depthScale ?? 1), options.segments);
    const geometry = unitCylinder(sides, options.taper ?? 1, options.open ?? false);
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
    );
  }

  /** A rod between two points. */
  rod(layer: LayerName, from: Vector3, to: Vector3, radius: number, segments = 6): void {
    const length = from.distanceTo(to);
    const geometry = new CylinderGeometry(radius, radius, length, segments, 1, false);
    geometry.translate(0, length / 2, 0);
    // Turn +Y onto the rod direction.
    const direction = new Vector3().subVectors(to, from).normalize();
    const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction);
    const matrix = new Matrix4().compose(from, rotation, new Vector3(1, 1, 1));
    this.add(layer, geometry, matrix);
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
    } = {},
  ): void {
    this.add(
      layer,
      radius * Math.max(options.sx ?? 1, options.sy ?? 1, options.sz ?? 1) < 0.05
        ? smallSphere
        : unitSphere,
      at(x, y, z, {
        rx: options.rx,
        ry: options.ry,
        rz: options.rz,
        sx: radius * (options.sx ?? 1),
        sy: radius * (options.sy ?? 1),
        sz: radius * (options.sz ?? 1),
      }),
      options.color,
    );
  }

  /** A flat ring lying on a surface at height y. */
  ring(layer: LayerName, x: number, y: number, z: number, radius: number, tube: number): void {
    const geometry = new TorusGeometry(radius, tube, 3, lowPolySides(radius) + 4);
    this.add(layer, geometry, at(x, y, z, { rx: Math.PI / 2 }));
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
