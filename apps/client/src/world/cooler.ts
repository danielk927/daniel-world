import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  Group,
  InstancedBufferAttribute,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  SRGBColorSpace,
  ShaderMaterial,
  Vector3,
} from 'three';
import {
  COOLER,
  COOLER_DOOR,
  COOLER_HITS_TO_OPEN,
  DOORS,
  ROOM_HALF_X,
  createRandom,
  type CoolerDent,
} from '@world/shared';
import { at } from './builder.ts';
import { worldTime } from './clock.ts';
import { COLD_LIGHT, COOLER_LAMPS, READOUT } from './coolerRoom.ts';
import { softTexture } from './textures.ts';

/**
 * The walk-in cooler's door, a secret on the east wall (its frame and the room behind it are in
 * coolerRoom.ts): it dents where it is hit, scuffs, loses its handle and its temperature readout,
 * shifts in its frame, and at last bursts open, swinging in against the cooler's wall as cold air
 * rolls out into the kitchen.
 */

/** The kitchen face of the east wall, where the door's face is when it is shut. */
const FACE = ROOM_HALF_X;
const DOORWAY = DOORS.walkIn;

// ---------- The door: dynamic ----------

const LEAF_WIDTH = COOLER_DOOR.to - COOLER_DOOR.from;
const LEAF_HEIGHT = COOLER_DOOR.top - COOLER_DOOR.bottom;
const THICKNESS = COOLER_DOOR.thickness;
/** Face cells are this big, so a dent is several facets across. */
const CELL = 0.035;
/** The kick plate along the bottom of the face, this tall. */
const KICK = 0.3;
/** The rim of the door is stiff: dents fade out this close to its edges. */
const RIM = 0.05;
/** However often it is hit, the face caves in no further than this. */
const MAX_DEPTH = 0.075;
/** The door lies open at a right angle, flat against the cooler's south wall. */
const OPEN_ANGLE = Math.PI / 2;

/** The shape of one dent, derived from where it landed and when, the same on every screen. */
interface DentShape {
  readonly z: number;
  readonly y: number;
  /** Half sizes across the door and up it, and a turn in the door's plane. */
  readonly rz: number;
  readonly ry: number;
  readonly cos: number;
  readonly sin: number;
  readonly depth: number;
  readonly fist: boolean;
  /** How dark the scuff in the middle is. */
  readonly scuff: number;
}

/** The shape of the `index`th dent: everything but its place comes from a seed of that place. */
export function dentShape(dent: CoolerDent, index: number): DentShape {
  const seed = Math.round(dent.z * 1000) * 7919 + Math.round(dent.y * 1000) * 104729 + index * 31;
  const random = createRandom(seed);
  const fist = dent.by === 'fist';
  const turn = (random() - 0.5) * 0.7;
  return {
    z: dent.z,
    y: dent.y,
    rz: fist ? 0.11 + random() * 0.03 : 0.045 + random() * 0.015,
    ry: fist ? 0.075 + random() * 0.02 : 0.03 + random() * 0.01,
    cos: Math.cos(turn),
    sin: Math.sin(turn),
    depth: fist ? 0.025 + random() * 0.009 : 0.012 + random() * 0.004,
    fist,
    scuff: fist ? 0.12 + random() * 0.06 : 0.22 + random() * 0.08,
  };
}

/** How far in a dent pushes the face at (z, y), and how much it scuffs it there (0 to 1). */
function dentAt(
  shape: DentShape,
  z: number,
  y: number,
  out: { depth: number; scuff: number },
): void {
  const dz = z - shape.z;
  const dy = y - shape.y;
  const u = (dz * shape.cos + dy * shape.sin) / shape.rz;
  const v = (-dz * shape.sin + dy * shape.cos) / shape.ry;
  const r2 = u * u + v * v;
  out.depth = 0;
  out.scuff = 0;
  if (r2 >= 2.2) return;
  if (r2 < 1) {
    const bowl = (1 - r2) * (1 - r2);
    let depth = shape.depth * bowl;
    if (shape.fist) {
      // Four knuckles, pressed a little deeper in a row across the dent.
      for (let k = 0; k < 4; k++) {
        const ku = u - (-0.54 + k * 0.36);
        const kv = v + 0.1 + Math.abs(k - 1.5) * 0.08;
        const k2 = (ku * ku) / 0.03 + (kv * kv) / 0.09;
        if (k2 < 1) depth += shape.depth * 0.45 * (1 - k2) * (1 - k2);
      }
    }
    out.depth = depth;
  } else {
    // The steel pushed out of the way stands up in a low rim.
    const t = (Math.sqrt(r2) - 1) / (Math.sqrt(2.2) - 1);
    out.depth = -shape.depth * 0.14 * Math.sin(Math.PI * t);
  }
  out.scuff = shape.scuff * Math.exp(-r2 * 1.6);
}

/** The door's look at each stage of damage: hits so far, 0 to 9. */
export interface Damage {
  /** The whole face bows in, meters at the middle. */
  readonly bow: number;
  /** The handle hangs this far round from level, radians. */
  readonly handle: number;
  /** The door has shifted in its frame: turned in (radians) and dropped (meters). */
  readonly shift: number;
  readonly sag: number;
  /** The face's steel darkens with grime and scuffs, overall. */
  readonly grime: number;
  /** The readout: the temperature it shows, how often it flickers, and whether it works at all. */
  readonly temperature: number;
  readonly flicker: number;
  readonly dead: boolean;
}

export function damageAt(hits: number): Damage {
  const n = Math.max(0, Math.min(COOLER_HITS_TO_OPEN - 1, hits));
  const handle = [0, 0, 0, 0.09, 0.14, 0.24, 0.33, 0.48, 0.66, 1.15][n]!;
  return {
    bow: Math.max(0, n - 3) * 0.006,
    handle,
    shift: n >= 9 ? 0.03 : n >= 8 ? 0.012 : 0,
    sag: n >= 9 ? 0.014 : n >= 8 ? 0.006 : 0,
    grime: n * 0.025,
    temperature: [3.0, 3.0, 3.1, 3.4, 4.1, 5.6, 8.8, 0, 0, 0][n]!,
    flicker: n >= 6 ? 0.85 : n >= 5 ? 0.35 : n >= 4 ? 0.08 : 0,
    dead: n >= 7,
  };
}

// The door's own frame: the hinge axis at the origin, x from the face (-THICKNESS) to the back
// (0), z from the latch edge (-LEAF_WIDTH) to the hinge edge (0), y up from the floor.

const STEEL_FACE = new Color('#c4cacd');
const KICK_PLATE = new Color('#a9afb3');
const EDGE = new Color('#b3b9bc');
const BACK = new Color('#e7ecef');
const HANDLE = new Color('#eef1f2');
const LOCK = new Color('#2c2f33');
const SCUFF = new Color('#5f6468');

interface FaceGrid {
  readonly y0: number;
  readonly y1: number;
  readonly rows: number;
  readonly paint: Color;
  /** Where its vertices start in the leaf's arrays. */
  readonly offset: number;
}

const COLUMNS = Math.round(LEAF_WIDTH / CELL);
const KICK_ROWS = Math.round(KICK / CELL);
const UPPER_ROWS = Math.round((LEAF_HEIGHT - KICK) / CELL);

/**
 * Boxes for the handle and the hinges, as eight corners each, in the door's frame. The handle is a
 * lever on a rose near the latch edge; damage turns it round the rose until it hangs.
 */
const BOX_CORNERS = [
  [0, 0, 0],
  [1, 0, 0],
  [1, 1, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 0, 1],
  [1, 1, 1],
  [0, 1, 1],
] as const;
/** Each face of a box as four corners, wound outward. */
const BOX_FACES = [
  [1, 2, 6, 5],
  [0, 4, 7, 3],
  [3, 7, 6, 2],
  [0, 1, 5, 4],
  [4, 5, 6, 7],
  [0, 3, 2, 1],
] as const;

interface Part {
  readonly min: Vector3;
  readonly max: Vector3;
  readonly paint: Color;
  /** Turns with the handle. */
  readonly handle: boolean;
}

const ROSE = { z: -LEAF_WIDTH + 0.14, y: 1.08 };
const FACE_X = -THICKNESS;
const PARTS: readonly Part[] = [
  // The rose and the lock cylinder under it.
  {
    min: new Vector3(FACE_X - 0.018, ROSE.y - 0.045, ROSE.z - 0.045),
    max: new Vector3(FACE_X, ROSE.y + 0.045, ROSE.z + 0.045),
    paint: HANDLE,
    handle: false,
  },
  {
    min: new Vector3(FACE_X - 0.012, ROSE.y - 0.13, ROSE.z - 0.018),
    max: new Vector3(FACE_X, ROSE.y - 0.08, ROSE.z + 0.018),
    paint: LOCK,
    handle: false,
  },
  // The lever's neck and its arm, reaching toward the hinge side.
  {
    min: new Vector3(FACE_X - 0.06, ROSE.y - 0.014, ROSE.z - 0.014),
    max: new Vector3(FACE_X - 0.018, ROSE.y + 0.014, ROSE.z + 0.014),
    paint: HANDLE,
    handle: true,
  },
  {
    min: new Vector3(FACE_X - 0.075, ROSE.y - 0.02, ROSE.z - 0.02),
    max: new Vector3(FACE_X - 0.05, ROSE.y + 0.02, ROSE.z + 0.27),
    paint: HANDLE,
    handle: true,
  },
  // Three hinge knuckles on the hinge axis, at the back of the hinge edge.
  ...[0.32, 1.1, 1.88].map((y) => ({
    min: new Vector3(-0.022, y - 0.08, -0.022),
    max: new Vector3(0.022, y + 0.08, 0.022),
    paint: HANDLE,
    handle: false,
  })),
];

/**
 * The walk-in's door, as everyone in the room sees it: dented where the server says it was hit,
 * worse with every hit, then swinging open. Also the temperature readout beside it and the cold
 * mist that rolls out once it is open.
 */
export class CoolerDoor {
  /** The door, turning on its hinge. */
  readonly leaf: Mesh<BufferGeometry, MeshStandardMaterial>;
  readonly readout: Mesh<PlaneGeometry, MeshBasicMaterial>;
  readonly mist: InstancedMesh;
  /**
   * The cold room's light on what moves in it (the open door, cooks, knives); its walls have theirs
   * baked in. Dark while the door is shut, so it never shines through the walls into the kitchen.
   */
  readonly light: PointLight;
  private readonly lightPower: number;
  /** Everything to add to the scene. */
  readonly group = new Group();
  /**
   * Where the door has carried what is stuck in it, from where it stuck: knives in the door move
   * with it (see Knives.setCarrier).
   */
  readonly motion = new Matrix4();
  /** Called whenever `motion` changes. */
  onMove: (() => void) | null = null;

  private readonly shapes: DentShape[] = [];
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly grids: FaceGrid[] = [];
  private readonly partsOffset: number;
  private readonly restInverse = new Matrix4();

  /** The swing, in radians from shut, and how fast it is turning. */
  angle = 0;
  private velocity = 0;
  private swinging = false;
  /** World time and strength of the last hit's jolt. */
  private joltAt = -Infinity;
  private joltStrength = 0;
  private damage = damageAt(0);
  private moved = true;

  private readonly readoutCtx: CanvasRenderingContext2D;
  private readonly readoutTexture: CanvasTexture;
  private readonly readoutGlow: number;
  private shownTemperature = -1;
  private readonly random = createRandom(4242);
  private flickerUntil = 0;
  private garbled = false;
  private readonly mistOpen: { value: number };

  private readonly sample = { depth: 0, scuff: 0 };
  private readonly color = new Color();
  private readonly point = new Vector3();
  private readonly turn = new Matrix4();
  private readonly offset = new Matrix4();

  constructor(hdr: boolean) {
    // The face is two grids (the kick plate, the steel above it) so the plate has a crisp edge;
    // then the edges and back, the handle and the hinges.
    let vertices = 0;
    for (const [y0, y1, rows, paint] of [
      [COOLER_DOOR.bottom, COOLER_DOOR.bottom + KICK, KICK_ROWS, KICK_PLATE],
      [COOLER_DOOR.bottom + KICK, COOLER_DOOR.top, UPPER_ROWS, STEEL_FACE],
    ] as const) {
      this.grids.push({ y0, y1, rows, paint, offset: vertices });
      vertices += (COLUMNS + 1) * (rows + 1);
    }
    const shellOffset = vertices;
    vertices += 5 * 4;
    this.partsOffset = vertices;
    vertices += PARTS.length * 24;

    this.positions = new Float32Array(vertices * 3);
    this.colors = new Float32Array(vertices * 3);
    const index: number[] = [];
    for (const grid of this.grids) {
      for (let j = 0; j < grid.rows; j++) {
        for (let i = 0; i < COLUMNS; i++) {
          const a = grid.offset + j * (COLUMNS + 1) + i;
          const b = a + 1;
          const c = a + COLUMNS + 1;
          const d = c + 1;
          // The face looks toward -x.
          index.push(a, b, d, a, d, c);
        }
      }
    }
    for (let q = 0; q < 5 + PARTS.length * 6; q++) {
      const base = shellOffset + q * 4;
      index.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    this.writeShell(shellOffset);

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new BufferAttribute(this.colors, 3));
    geometry.setIndex(index);
    this.leaf = new Mesh(
      geometry,
      // Brushed steel like the kitchen's, painted per vertex so scuffs can darken it. Smooth
      // shaded, unlike the kitchen's flat facets: a dent reads by the light rolling across it.
      new MeshStandardMaterial({
        vertexColors: true,
        metalness: 0.55,
        roughness: 0.38,
        envMapIntensity: 12,
      }),
    );
    this.leaf.name = 'cooler-door';
    this.leaf.receiveShadow = true;
    this.leaf.position.set(COOLER_DOOR.hingeX, 0, COOLER_DOOR.hingeZ);
    this.leaf.updateMatrix();
    this.restInverse.copy(this.leaf.matrix).invert();
    this.leaf.matrixAutoUpdate = false;
    this.rebuild();
    geometry.computeBoundingSphere();

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 48;
    this.readoutCtx = canvas.getContext('2d')!;
    this.readoutTexture = new CanvasTexture(canvas);
    this.readoutTexture.colorSpace = SRGBColorSpace;
    this.readoutGlow = hdr ? 1.5 : 1;
    this.readout = new Mesh(
      new PlaneGeometry(READOUT.width, READOUT.height).applyMatrix4(
        at(READOUT.x, READOUT.y, READOUT.z, { ry: -Math.PI / 2 }),
      ),
      new MeshBasicMaterial({ map: this.readoutTexture }),
    );
    this.readout.name = 'cooler-readout';
    this.readout.matrixAutoUpdate = false;
    this.drawReadout(3.0);

    this.mistOpen = { value: 1e9 };
    this.mist = createMist(this.mistOpen);
    this.lightPower = hdr ? 11 : 7;
    this.light = new PointLight(COLD_LIGHT, 0, 4.6, 2);
    this.light.position.set((COOLER.minX + COOLER.maxX) / 2, COOLER.height - 0.3, COOLER_LAMPS.z);
    this.group.add(this.leaf, this.readout, this.mist, this.light);
  }

  /** Hits taken so far, as shown. */
  get hits(): number {
    return this.shapes.length;
  }

  /** Burst open (it may still be swinging). */
  get open(): boolean {
    return this.shapes.length >= COOLER_HITS_TO_OPEN;
  }

  /** Whether any of the cold room can be seen past the door: open, or shifted in its frame. */
  get showsInside(): boolean {
    return this.angle > 0 || this.damage.shift > 0;
  }

  /** Whether a knife stuck with its tip at (x, y, z) is in the door, to be carried with it. */
  carries(x: number, y: number, z: number): boolean {
    return (
      x >= FACE - 1e-3 &&
      x <= FACE + THICKNESS &&
      z >= COOLER_DOOR.from &&
      z <= COOLER_DOOR.to &&
      y >= COOLER_DOOR.bottom &&
      y <= COOLER_DOOR.top
    );
  }

  /** Show exactly these hits, at once: shut and dented, or open against the wall. */
  reset(dents: readonly CoolerDent[]): void {
    this.shapes.length = 0;
    dents.slice(0, COOLER_HITS_TO_OPEN).forEach((dent, i) => this.shapes.push(dentShape(dent, i)));
    this.damage = damageAt(this.shapes.length);
    this.swinging = false;
    this.velocity = 0;
    this.joltAt = -Infinity;
    this.angle = this.open ? OPEN_ANGLE : 0;
    // Long open already: the mist only drifts, with no burst.
    this.mistOpen.value = this.open ? -1e4 : 1e9;
    this.flickerUntil = 0;
    this.garbled = false;
    this.rebuild();
    this.moved = true;
  }

  /** Take a hit, now: a dent where it landed, a jolt, and on the last, the door bursts open. */
  hit(dent: CoolerDent, time: number): void {
    if (this.open) return;
    this.shapes.push(dentShape(dent, this.shapes.length));
    this.damage = damageAt(this.shapes.length);
    this.joltAt = time;
    this.joltStrength = dent.by === 'fist' ? 1 : 0.6;
    this.flickerUntil = time + 0.25;
    if (this.open) {
      // The latch gives: the door flies in, slams against the wall and bounces a little.
      this.swinging = true;
      this.velocity = 3.4;
      this.mistOpen.value = time;
    }
    this.rebuild();
    this.moved = true;
  }

  /** Per frame: the swing, the jolt, the readout's flicker. */
  update(time: number, dt: number): void {
    if (this.swinging) this.swing(dt);
    const sinceJolt = time - this.joltAt;
    const jolting = sinceJolt < 0.5;
    if (jolting || this.swinging || this.moved) this.place(time);
    this.flickerReadout(time);
  }

  /** The door swings on, pushed open by its own weight, and bounces off the wall. */
  private swing(dt: number): void {
    const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      this.velocity += (7 - this.velocity * 0.8) * h;
      this.angle += this.velocity * h;
      if (this.angle >= OPEN_ANGLE) {
        this.angle = OPEN_ANGLE;
        if (this.velocity < 0.6) {
          this.velocity = 0;
          this.swinging = false;
          break;
        }
        this.velocity = -this.velocity * 0.3;
      }
    }
  }

  /** Put the door where its swing, its shift in the frame and the last jolt have it. */
  private place(time: number): void {
    this.moved = false;
    const sinceJolt = time - this.joltAt;
    const jolt =
      sinceJolt >= 0 && sinceJolt < 0.5
        ? this.joltStrength * Math.exp(-sinceJolt * 9) * Math.sin(sinceJolt * 70)
        : 0;
    const shut = this.angle === 0 ? 1 : Math.max(0, 1 - this.angle * 4);
    const turn = this.angle + (this.damage.shift + Math.abs(jolt) * 0.016) * shut;
    const sag = this.damage.sag * shut;
    this.turn.makeRotationY(-turn);
    // A jolt rattles it in its frame; damage drops it on its hinges.
    this.offset.makeTranslation(Math.abs(jolt) * 0.004, -sag, 0);
    this.leaf.matrix
      .makeTranslation(COOLER_DOOR.hingeX, 0, COOLER_DOOR.hingeZ)
      .multiply(this.turn)
      .multiply(this.offset);
    if (sag > 0) {
      // Dropped on its hinges, the latch side hangs lowest.
      this.offset.makeRotationX(-sag * 0.6);
      this.leaf.matrix.multiply(this.offset);
    }
    this.leaf.matrixWorldNeedsUpdate = true;
    this.light.intensity = this.lightPower * Math.min(1, this.angle / 0.6 + this.damage.shift * 3);
    this.motion.multiplyMatrices(this.leaf.matrix, this.restInverse);
    this.onMove?.();
  }

  /** Lay out the face from the dents and the damage, the handle at its angle, and paint it all. */
  private rebuild(): void {
    const { bow, grime } = this.damage;
    const positions = this.positions;
    const colors = this.colors;
    const sample = this.sample;
    for (const grid of this.grids) {
      for (let j = 0; j <= grid.rows; j++) {
        const y = grid.y0 + ((grid.y1 - grid.y0) * j) / grid.rows;
        for (let i = 0; i <= COLUMNS; i++) {
          const zLocal = -LEAF_WIDTH + (LEAF_WIDTH * i) / COLUMNS;
          const z = COOLER_DOOR.hingeZ + zLocal;
          let depth = 0;
          let scuff = 0;
          for (const shape of this.shapes) {
            dentAt(shape, z, y, sample);
            depth += sample.depth;
            scuff = Math.max(scuff, sample.scuff);
          }
          // The face bows in, most in the middle, and its stiff rim never moves.
          const u = (2 * i) / COLUMNS - 1;
          const v = (2 * (y - COOLER_DOOR.bottom)) / LEAF_HEIGHT - 1;
          depth += bow * (1 - u * u) * (1 - v * v);
          const fromEdge = Math.min(
            -zLocal,
            LEAF_WIDTH + zLocal,
            y - COOLER_DOOR.bottom,
            COOLER_DOOR.top - y,
          );
          const rim = Math.min(1, Math.max(0, fromEdge / RIM));
          depth = Math.min(MAX_DEPTH, depth) * rim * rim * (3 - 2 * rim);
          const k = (grid.offset + j * (COLUMNS + 1) + i) * 3;
          positions[k] = FACE_X + depth;
          positions[k + 1] = y;
          positions[k + 2] = zLocal;
          // Worn steel, darker where it was struck.
          this.color.copy(grid.paint).multiplyScalar(1 - grime);
          this.color.lerp(SCUFF, Math.min(0.5, scuff));
          colors[k] = this.color.r;
          colors[k + 1] = this.color.g;
          colors[k + 2] = this.color.b;
        }
      }
    }
    this.writeParts();
    const geometry = this.leaf?.geometry;
    if (geometry) {
      geometry.getAttribute('position').needsUpdate = true;
      geometry.getAttribute('color').needsUpdate = true;
      geometry.computeVertexNormals();
    }
  }

  /** The door's edges and back, which never dent: four quads round the rim and one behind. */
  private writeShell(offset: number): void {
    const w = LEAF_WIDTH;
    const y0 = COOLER_DOOR.bottom;
    const y1 = COOLER_DOOR.top;
    const quads: [number[][], Color][] = [
      // The latch edge, the hinge edge, the top and the bottom.
      [
        [
          [FACE_X, y0, -w],
          [0, y0, -w],
          [0, y1, -w],
          [FACE_X, y1, -w],
        ],
        EDGE,
      ],
      [
        [
          [0, y0, 0],
          [FACE_X, y0, 0],
          [FACE_X, y1, 0],
          [0, y1, 0],
        ],
        EDGE,
      ],
      [
        [
          [FACE_X, y1, -w],
          [0, y1, -w],
          [0, y1, 0],
          [FACE_X, y1, 0],
        ],
        EDGE,
      ],
      [
        [
          [FACE_X, y0, 0],
          [0, y0, 0],
          [0, y0, -w],
          [FACE_X, y0, -w],
        ],
        EDGE,
      ],
      // The back, white like the cooler's panels.
      [
        [
          [0, y0, -w],
          [0, y0, 0],
          [0, y1, 0],
          [0, y1, -w],
        ],
        BACK,
      ],
    ];
    quads.forEach(([corners, paint], q) => {
      // Listed going round each face; wound the other way, so each faces out of the door.
      [...corners].reverse().forEach(([x, y, z], c) => {
        const k = (offset + q * 4 + c) * 3;
        this.positions.set([x!, y!, z!], k);
        this.colors.set([paint.r, paint.g, paint.b], k);
      });
    });
  }

  /** The handle, turned round its rose as far as the damage has knocked it, and the hinges. */
  private writeParts(): void {
    const angle = this.damage.handle;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const p = this.point;
    PARTS.forEach((part, n) => {
      BOX_FACES.forEach((face, f) => {
        face.forEach((corner, c) => {
          const [cx, cy, cz] = BOX_CORNERS[corner];
          p.set(
            cx ? part.max.x : part.min.x,
            cy ? part.max.y : part.min.y,
            cz ? part.max.z : part.min.z,
          );
          if (part.handle) {
            // Turned in the door's plane round the rose: the free end drops.
            const dz = p.z - ROSE.z;
            const dy = p.y - ROSE.y;
            p.z = ROSE.z + dz * cos + dy * sin;
            p.y = ROSE.y - dz * sin + dy * cos;
          }
          const k = (this.partsOffset + n * 24 + f * 4 + c) * 3;
          this.positions[k] = p.x;
          this.positions[k + 1] = p.y;
          this.positions[k + 2] = p.z;
          this.colors[k] = part.paint.r;
          this.colors[k + 1] = part.paint.g;
          this.colors[k + 2] = part.paint.b;
        });
      });
    });
  }

  /** The readout: steady, then flickering as the door takes a beating, then dark. */
  private flickerReadout(time: number): void {
    const { temperature, flicker, dead } = this.damage;
    let level = 1;
    if (dead) {
      // One last stutter as it goes, garbled, then nothing.
      level = time < this.flickerUntil && this.random() < 0.3 ? 0.6 : 0;
      this.garbled = true;
    } else {
      if (time < this.flickerUntil) level = this.random() < 0.5 ? 0.15 : 1;
      else if (flicker > 0 && this.random() < flicker * 0.06) {
        this.flickerUntil = time + 0.04 + this.random() * 0.12 * flicker;
        this.garbled = flicker > 0.5 && this.random() < 0.5;
      }
    }
    const garbled = this.garbled && time < this.flickerUntil;
    const shown = level === 0 ? -2 : garbled ? 88.8 : temperature;
    if (shown !== this.shownTemperature) this.drawReadout(shown);
    this.readout.material.color.setScalar(this.readoutGlow * Math.max(level, 0.0001));
  }

  /** Draw the readout's face: the temperature in red seven-segment digits, or dark. */
  private drawReadout(value: number): void {
    this.shownTemperature = value;
    const ctx = this.readoutCtx;
    ctx.fillStyle = '#0b0909';
    ctx.fillRect(0, 0, 128, 48);
    const lit = '#ff4a2e';
    const unlit = '#2a0f0b';
    const on = value > -1;
    const tenths = on ? Math.round(value * 10) : 0;
    const tens = Math.floor(tenths / 100) % 10;
    // Whole degrees in big digits (no leading zero), the tenth after a clear point in small, so it
    // never reads as thirty.
    const big = { w: 17, h: 30, t: 4, y: 9 };
    sevenSegment(ctx, 12, big, on && tens > 0 ? tens : -1, lit, unlit);
    sevenSegment(ctx, 38, big, on ? Math.floor(tenths / 10) % 10 : -1, lit, unlit);
    ctx.fillStyle = on ? lit : unlit;
    ctx.fillRect(62, 34, 5, 5);
    sevenSegment(ctx, 72, { w: 10, h: 18, t: 3, y: 21 }, on ? tenths % 10 : -1, lit, unlit);
    // A small degree sign and C.
    ctx.strokeStyle = on ? lit : unlit;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(98, 13, 3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = '600 17px Jost, sans-serif';
    ctx.fillText('C', 104, 37);
    this.readoutTexture.needsUpdate = true;
  }
}

/** Which of the seven segments (a to g) each digit lights. */
const DIGITS = [
  0b1111110, 0b0110000, 0b1101101, 0b1111001, 0b0110011, 0b1011011, 0b1011111, 0b1110000, 0b1111111,
  0b1111011,
];
const SEGMENTS: readonly (readonly [number, number, boolean])[] = [
  [0.5, 0, true],
  [1, 0.5, false],
  [1, 1.5, false],
  [0.5, 2, true],
  [0, 1.5, false],
  [0, 0.5, false],
  [0.5, 1, true],
];

function sevenSegment(
  ctx: CanvasRenderingContext2D,
  x: number,
  size: { w: number; h: number; t: number; y: number },
  value: number,
  lit: string,
  unlit: string,
): void {
  const mask = value >= 0 ? DIGITS[value]! : 0;
  const half = size.h / 2;
  SEGMENTS.forEach(([sx, sy, horizontal], i) => {
    ctx.fillStyle = (mask >> (6 - i)) & 1 ? lit : unlit;
    const cx = x + sx * size.w;
    const cy = size.y + sy * half;
    const length = (horizontal ? size.w : half) - size.t * 0.6;
    const t = size.t / 2;
    ctx.beginPath();
    if (horizontal) {
      ctx.moveTo(cx - length / 2, cy);
      ctx.lineTo(cx - length / 2 + t, cy - t);
      ctx.lineTo(cx + length / 2 - t, cy - t);
      ctx.lineTo(cx + length / 2, cy);
      ctx.lineTo(cx + length / 2 - t, cy + t);
      ctx.lineTo(cx - length / 2 + t, cy + t);
    } else {
      ctx.moveTo(cx, cy - length / 2);
      ctx.lineTo(cx + t, cy - length / 2 + t);
      ctx.lineTo(cx + t, cy + length / 2 - t);
      ctx.lineTo(cx, cy + length / 2);
      ctx.lineTo(cx - t, cy + length / 2 - t);
      ctx.lineTo(cx - t, cy - length / 2 + t);
    }
    ctx.closePath();
    ctx.fill();
  });
}

/** Puffs of cold air at once, rolling out of the doorway. */
const MIST_PUFFS = 120;

/**
 * Cold air pouring out of the open walk-in: puffs that leave the doorway low, roll out across the
 * kitchen floor, sink and spread and fade. A burst when the door gives, then a steady drift. Every
 * puff loops on its own clock in the vertex shader, like the steam, so the CPU never touches it.
 */
function createMist(open: { value: number }): InstancedMesh {
  const random = createRandom(909);
  const seeds = new Float32Array(MIST_PUFFS * 3);
  for (let i = 0; i < seeds.length; i++) seeds[i] = random();
  const material = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      uTime: worldTime,
      uOpen: open,
      uMap: { value: softTexture() },
      uDoor: { value: new Vector3(FACE + 0.08, DOORWAY.from + 0.12, DOORWAY.to - 0.25) },
    },
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uOpen;
      uniform vec3 uDoor;
      attribute vec3 aSeed;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        vUv = uv;
        float since = uTime - uOpen;
        float period = 3.4 + aSeed.x * 2.4;
        // The first wave leaves together as the door gives; each puff then loops on its own clock,
        // and since their periods differ, they soon spread out into a steady drift.
        float age = since - aSeed.y * 0.5;
        if (age < 0.0) {
          gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
          vAlpha = 0.0;
          return;
        }
        float t = fract(age / period);
        // How hard the air was rushing out when this puff left.
        float burst = exp(-max(0.0, since - t * period) / 1.4);
        float reach = (1.1 + aSeed.z * 1.5) * (1.0 + burst * 1.3);
        vec3 c;
        c.x = uDoor.x - reach * (1.0 - pow(1.0 - t, 1.8));
        float lane = fract(aSeed.x * 7.31 + aSeed.z * 3.7);
        c.z = mix(uDoor.y, uDoor.z, lane) + (lane - 0.5) * 1.4 * t;
        float start = 0.08 + pow(aSeed.y, 1.5) * (0.9 + burst * 0.8);
        c.y = mix(start, 0.1 + aSeed.z * 0.12, smoothstep(0.0, 0.8, t));
        float size = mix(0.7, 2.3, t) * (1.0 + burst * 0.6);
        vAlpha = smoothstep(0.0, 0.06, t) * pow(1.0 - t, 1.3) * (0.09 + 0.22 * burst);
        vec4 view = modelViewMatrix * vec4(c, 1.0);
        // Wider than tall: the cold air lies low and spreads.
        view.xy += position.xy * size * vec2(1.0, 0.6);
        gl_Position = projectionMatrix * view;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D uMap;
      varying vec2 vUv;
      varying float vAlpha;
      void main() {
        float a = texture2D(uMap, vUv).r * vAlpha;
        gl_FragColor = vec4(vec3(0.86, 0.92, 1.0), a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });
  const geometry = new PlaneGeometry(1, 1);
  geometry.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 3));
  const mesh = new InstancedMesh(geometry, material, MIST_PUFFS);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = 'cooler-mist';
  return mesh;
}
