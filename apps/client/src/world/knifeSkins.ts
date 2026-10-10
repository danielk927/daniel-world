import { BoxGeometry, type BufferGeometry } from 'three';
import type { KnifeSkin } from '@world/shared';
import {
  arc,
  blade,
  box,
  mergeNonIndexed,
  muzzleRing,
  pin,
  ring,
  slab,
  slot,
  type Joint,
  type KnifePart,
  type PartKind,
  type PartShape,
  type V2,
} from './knifeShapes.ts';

/**
 * The knives, each an original low-poly model after the knives CS2 players love most, built from
 * the shapes in knifeShapes.ts. Each reads by its silhouette: the karambit's claw and finger ring,
 * the butterfly's slotted handles, the M9's saw back and guard, the bayonet's muzzle ring, the flip
 * knife's thumb hole, the gut knife's hook, and so on.
 *
 * Model space: the tip at the origin, the knife along +Z to its butt, the spine up and the flat of
 * the blade facing ±X, as for the kitchen's chef's knife (knifeModel.ts).
 */
export interface KnifeModel {
  readonly skin: KnifeSkin;
  readonly name: string;
  readonly parts: readonly KnifePart[];
  /** Where a hand holds it. */
  readonly grip: V2;
  /** Its middle, which it tumbles about in flight. */
  readonly center: V2;
  /** What it turns about in the hand when it is spun: a finger ring, or the grip. */
  readonly pivot: V2;
  /**
   * How the hand holds it: `chef` blade up out of the fist and edge on, as the chef's knife always
   * was; `forward` the same, but turned to show the flat of the blade (and so the knife's shape) to
   * the eye, as CS2 shows a knife; `reverse` (a karambit) the ring over the fist and the blade out
   * of its heel.
   */
  readonly hold: 'chef' | 'forward' | 'reverse';
}

const STEEL = '#b9c0c6';
const DARK_STEEL = '#80878e';
const BLADE = 0.005;

function part(
  name: string,
  kind: PartKind,
  shape: PartShape,
  options: { color?: string; joint?: Joint } = {},
): KnifePart {
  return { name, kind, ...shape, ...options };
}

/** Teeth along a spine, `count` of them from `z0`, each `pitch` long and `depth` tall. */
function saw(z0: number, count: number, pitch: number, y: number, depth: number): V2[] {
  const teeth: V2[] = [];
  for (let i = 0; i < count; i++) {
    const z = z0 + i * pitch;
    teeth.push([z, y], [z + pitch * 0.72, y + depth]);
  }
  teeth.push([z0 + count * pitch, y]);
  return teeth;
}

/** Thin bands around a grip, like the rings of a rubber handle. */
function bands(
  name: string,
  zs: readonly number[],
  width: number,
  y0: number,
  y1: number,
  thickness: number,
  color: string,
): KnifePart[] {
  return zs.map((z, i) =>
    part(`${name}${i}`, 'accent', box(z, z + width, y0, y1, thickness, { bevel: 0.0008 }), {
      color,
    }),
  );
}

// ---------- The kitchen's chef's knife, as it always was ----------

/** A box part from three's BoxGeometry, as the chef's knife was first built. */
function boxShape(geometry: BufferGeometry, outline: readonly V2[]): PartShape {
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  flat.deleteAttribute('uv');
  flat.computeVertexNormals();
  const merged = mergeNonIndexed([flat]);
  flat.dispose();
  return { geometry: merged, outline: [{ points: outline, hole: false }] };
}

function kitchen(): KnifeModel {
  const BLADE_LENGTH = 0.19;
  const HANDLE_LENGTH = 0.11;
  // The blade: a thin wedge, full height at the bolster, running to a point at the tip.
  const bladeBox = new BoxGeometry(0.006, 0.042, BLADE_LENGTH, 1, 1, 1);
  const position = bladeBox.getAttribute('position');
  for (let i = 0; i < position.count; i++) {
    const z = position.getZ(i);
    const y = position.getY(i);
    if (z < 0) {
      position.setY(i, y > 0 ? -0.012 : -0.021);
      position.setX(i, position.getX(i) * 0.4);
    }
  }
  bladeBox.translate(0, 0, BLADE_LENGTH / 2);
  const bolster = new BoxGeometry(0.014, 0.048, 0.015);
  bolster.translate(0, 0.002, BLADE_LENGTH + 0.0075);
  const handle = new BoxGeometry(0.02, 0.028, HANDLE_LENGTH);
  handle.translate(0, 0.004, BLADE_LENGTH + 0.015 + HANDLE_LENGTH / 2);
  const h0 = BLADE_LENGTH + 0.015;
  return {
    skin: 'kitchen',
    name: 'Chef’s Knife',
    parts: [
      part(
        'blade',
        'blade',
        boxShape(bladeBox, [
          [0, -0.021],
          [BLADE_LENGTH, -0.021],
          [BLADE_LENGTH, 0.021],
          [0, -0.012],
        ]),
      ),
      part(
        'bolster',
        'steel',
        boxShape(bolster, [
          [BLADE_LENGTH, -0.022],
          [h0, -0.022],
          [h0, 0.026],
          [BLADE_LENGTH, 0.026],
        ]),
        { color: '#9aa3ab' },
      ),
      part(
        'handle',
        'grip',
        boxShape(handle, [
          [h0, -0.01],
          [h0 + HANDLE_LENGTH, -0.01],
          [h0 + HANDLE_LENGTH, 0.018],
          [h0, 0.018],
        ]),
        { color: '#3a2a21' },
      ),
    ],
    grip: [h0 + HANDLE_LENGTH * 0.5, 0],
    center: [(BLADE_LENGTH + 0.015 + HANDLE_LENGTH) * 0.45, 0],
    pivot: [h0 + HANDLE_LENGTH * 0.5, 0],
    hold: 'chef',
  };
}

// ---------- Karambit ----------

function karambit(): KnifeModel {
  const grip = '#1c1d21';
  return {
    skin: 'karambit',
    name: 'Karambit',
    parts: [
      part(
        'blade',
        'blade',
        blade({
          // A claw: the spine sweeps round the outside of the curve, the edge along its inside.
          spine: [
            [0, 0],
            [0.003, 0.012],
            [0.009, 0.026],
            [0.018, 0.04],
            [0.031, 0.053],
            [0.047, 0.063],
            [0.066, 0.07],
            [0.086, 0.074],
            [0.106, 0.076],
          ],
          edge: [
            [0, 0],
            [0.009, 0.008],
            [0.02, 0.018],
            [0.033, 0.027],
            [0.048, 0.035],
            [0.064, 0.041],
            [0.082, 0.045],
            [0.106, 0.048],
          ],
          thickness: BLADE,
          grind: 0.5,
        }),
      ),
      part(
        'handle',
        'grip',
        slab(
          [
            [0.1, 0.08],
            [0.13, 0.083],
            [0.165, 0.086],
            [0.19, 0.088],
            [0.204, 0.085],
            [0.204, 0.058],
            [0.19, 0.054],
            [0.172, 0.056],
            [0.162, 0.051],
            [0.15, 0.056],
            [0.138, 0.051],
            [0.124, 0.055],
            [0.11, 0.046],
            [0.1, 0.045],
          ],
          0.016,
          { bevel: 0.0025 },
        ),
        { color: grip },
      ),
      part('ring', 'metal', ring([0.226, 0.071], 0.024, 0.015, 0.011)),
      part('pin0', 'steel', pin([0.122, 0.066], 0.0026, 0.018), { color: STEEL }),
      part('pin1', 'steel', pin([0.18, 0.071], 0.0026, 0.018), { color: STEEL }),
    ],
    grip: [0.16, 0.068],
    center: [0.12, 0.05],
    pivot: [0.226, 0.071],
    hold: 'reverse',
  };
}

// ---------- Butterfly knife ----------

const BUTTERFLY_PIVOT: V2 = [0.14, -0.002];

function butterflyHandle(x: number): PartShape {
  return slab(
    [
      [0.133, 0.0125],
      [0.28, 0.0125],
      [0.288, 0.009],
      [0.29, 0],
      [0.288, -0.0125],
      [0.28, -0.0165],
      [0.133, -0.0165],
      [0.129, -0.012],
      [0.129, 0.008],
    ],
    0.0075,
    {
      x,
      bevel: 0.0014,
      holes: [slot(0.156, 0.206, -0.0085, 0.0045), slot(0.216, 0.266, -0.0085, 0.0045)],
    },
  );
}

function butterfly(): KnifeModel {
  const bladeJoint: Joint = { channel: 'a', pivot: BUTTERFLY_PIVOT, sign: 1 };
  const biteJoint: Joint = { channel: 'b', pivot: BUTTERFLY_PIVOT, sign: 1, parent: 'blade' };
  return {
    skin: 'butterfly',
    name: 'Butterfly Knife',
    parts: [
      part(
        'blade',
        'blade',
        blade({
          spine: [
            [0, 0],
            [0.022, 0.006],
            [0.04, 0.0095],
            [0.128, 0.0105],
          ],
          edge: [
            [0, 0],
            [0.012, -0.008],
            [0.03, -0.0135],
            [0.06, -0.0155],
            [0.11, -0.0155],
            [0.128, -0.0145],
          ],
          thickness: BLADE * 0.9,
          grind: 0.45,
        }),
        { joint: bladeJoint },
      ),
      part(
        'tang',
        'blade',
        slab(
          [
            [0.127, -0.0145],
            [0.146, -0.0135],
            [0.148, -0.006],
            [0.146, 0.009],
            [0.127, 0.0105],
          ],
          BLADE * 0.9,
          { bevel: 0 },
        ),
        { joint: bladeJoint },
      ),
      part('safe', 'metal', butterflyHandle(0.0066)),
      part('bite', 'metal', butterflyHandle(-0.0066), { joint: biteJoint }),
      part('latch', 'steel', box(0.282, 0.293, -0.006, 0.003, 0.0042, { x: -0.0066 }), {
        color: DARK_STEEL,
        joint: biteJoint,
      }),
      part('pivotPin', 'steel', pin(BUTTERFLY_PIVOT, 0.0028, 0.0185), { color: STEEL }),
    ],
    grip: [0.215, -0.002],
    center: [0.15, -0.002],
    pivot: [0.215, -0.002],
    hold: 'forward',
  };
}

// ---------- M9 Bayonet ----------

function m9(): KnifeModel {
  const grip = '#262a22';
  const spineY = 0.0175;
  return {
    skin: 'm9',
    name: 'M9 Bayonet',
    parts: [
      part(
        'blade',
        'blade',
        blade({
          spine: [
            [0, 0],
            [0.03, 0.0085],
            [0.058, 0.0145],
            [0.074, spineY],
            ...saw(0.082, 9, 0.0072, spineY, 0.005),
            [0.176, spineY],
          ],
          edge: [
            [0, 0],
            [0.008, -0.0085],
            [0.022, -0.0145],
            [0.045, -0.0175],
            [0.15, -0.018],
            [0.164, -0.017],
            [0.176, -0.0165],
          ],
          thickness: BLADE * 1.1,
          grind: 0.34,
          holes: [slot(0.146, 0.168, -0.0025, 0.0065)],
        }),
      ),
      part(
        'guard',
        'metal',
        slab(
          [
            [0.175, 0.03],
            [0.181, 0.033],
            [0.187, 0.03],
            [0.187, -0.024],
            [0.182, -0.033],
            [0.172, -0.038],
            [0.165, -0.036],
            [0.166, -0.032],
            [0.174, -0.027],
            [0.175, -0.02],
          ],
          0.014,
          { bevel: 0.002 },
        ),
      ),
      part(
        'handle',
        'grip',
        slab(
          [
            [0.187, 0.0165],
            [0.215, 0.0178],
            [0.258, 0.0178],
            [0.292, 0.0158],
            [0.3, 0.015],
            [0.3, -0.015],
            [0.292, -0.0168],
            [0.258, -0.0188],
            [0.215, -0.0188],
            [0.187, -0.0168],
          ],
          0.022,
          { bevel: 0.0035 },
        ),
        { color: grip },
      ),
      ...bands('band', [0.206, 0.226, 0.246, 0.266], 0.0042, -0.0193, 0.0183, 0.0235, '#161811'),
      part(
        'pommel',
        'steel',
        slab(
          [
            [0.299, 0.0165],
            [0.31, 0.0175],
            [0.316, 0.012],
            [0.316, -0.012],
            [0.31, -0.0175],
            [0.299, -0.0165],
          ],
          0.024,
          { bevel: 0.003 },
        ),
        { color: STEEL },
      ),
    ],
    grip: [0.245, 0],
    center: [0.158, 0],
    pivot: [0.245, 0],
    hold: 'forward',
  };
}

// ---------- Bayonet ----------

function bayonet(): KnifeModel {
  const grip = '#2a2420';
  const fuller = slot(0.05, 0.15, 0.0025, 0.0085);
  return {
    skin: 'bayonet',
    name: 'Bayonet',
    parts: [
      part(
        'blade',
        'blade',
        blade({
          spine: [
            [0, 0],
            [0.028, 0.0095],
            [0.05, 0.0145],
            [0.166, 0.015],
          ],
          edge: [
            [0, 0],
            [0.01, -0.0095],
            [0.03, -0.015],
            [0.166, -0.0155],
          ],
          thickness: BLADE * 1.1,
          grind: 0.4,
          holes: [fuller],
        }),
      ),
      // The fuller: a groove down the flat, its floor thinner than the blade.
      part('fuller', 'blade', slab(fuller, BLADE * 0.45, { bevel: 0 })),
      part(
        'guard',
        'metal',
        slab(
          [
            [0.165, 0.027],
            [0.174, 0.027],
            [0.174, -0.017],
            [0.17, -0.021],
            [0.165, -0.019],
          ],
          0.014,
          { bevel: 0.002 },
        ),
      ),
      part('muzzle', 'metal', muzzleRing([0.1695, 0.0355], 0.0095, 0.0028)),
      part(
        'handle',
        'grip',
        slab(
          [
            [0.174, 0.0155],
            [0.21, 0.0168],
            [0.26, 0.0165],
            [0.288, 0.0148],
            [0.288, -0.0148],
            [0.26, -0.0172],
            [0.21, -0.0178],
            [0.174, -0.016],
          ],
          0.021,
          { bevel: 0.0035 },
        ),
        { color: grip },
      ),
      ...bands(
        'groove',
        [0.19, 0.206, 0.222, 0.238, 0.254, 0.27],
        0.0035,
        -0.0182,
        0.0172,
        0.0225,
        '#17130f',
      ),
      part(
        'pommel',
        'steel',
        slab(
          [
            [0.287, 0.0155],
            [0.3, 0.0165],
            [0.306, 0.011],
            [0.306, -0.011],
            [0.3, -0.0165],
            [0.287, -0.0155],
          ],
          0.022,
          { bevel: 0.003 },
        ),
        { color: STEEL },
      ),
      part('button', 'steel', box(0.292, 0.299, 0.016, 0.0195, 0.008, { bevel: 0.001 }), {
        color: DARK_STEEL,
      }),
    ],
    grip: [0.235, 0],
    center: [0.15, 0],
    pivot: [0.235, 0],
    hold: 'forward',
  };
}

// ---------- Flip knife ----------

const FLIP_PIVOT: V2 = [0.121, 0.002];

function flip(): KnifeModel {
  const grip = '#1d1f23';
  const bladeJoint: Joint = { channel: 'a', pivot: FLIP_PIVOT, sign: -1 };
  const scale = (x: number): PartShape =>
    slab(
      [
        [0.113, 0.0165],
        [0.14, 0.0168],
        [0.2, 0.016],
        [0.228, 0.0142],
        [0.237, 0.009],
        [0.237, -0.0095],
        [0.228, -0.015],
        [0.2, -0.0165],
        [0.168, -0.0162],
        [0.153, -0.0195],
        [0.138, -0.0168],
        [0.122, -0.0158],
        [0.111, -0.012],
        [0.109, 0.008],
      ],
      0.0062,
      { x, bevel: 0.0016 },
    );
  return {
    skin: 'flip',
    name: 'Flip Knife',
    parts: [
      part(
        'blade',
        'blade',
        blade({
          spine: [
            [0, 0],
            [0.02, 0.0085],
            [0.045, 0.0145],
            [0.085, 0.0168],
            [0.105, 0.0162],
            [0.116, 0.0152],
          ],
          edge: [
            [0, 0],
            [0.012, -0.008],
            [0.035, -0.0135],
            [0.075, -0.015],
            [0.116, -0.014],
          ],
          thickness: BLADE,
          grind: 0.3,
          // The thumb hole the knife is flipped open by.
          holes: [arc([0.092, 0.0062], 0.0062, 12).reverse()],
        }),
        { joint: bladeJoint },
      ),
      part(
        'tang',
        'blade',
        slab(
          [
            [0.115, -0.014],
            [0.124, -0.0135],
            [0.13, -0.008],
            [0.131, 0.006],
            [0.127, 0.0135],
            [0.115, 0.0152],
          ],
          BLADE,
          { bevel: 0 },
        ),
        { joint: bladeJoint },
      ),
      part('scaleL', 'grip', scale(0.0062), { color: grip }),
      part('scaleR', 'grip', scale(-0.0062), { color: grip }),
      part('spacer', 'steel', box(0.172, 0.234, -0.0165, -0.0125, 0.0068, { bevel: 0.0008 }), {
        color: DARK_STEEL,
      }),
      part('pivotPin', 'steel', pin(FLIP_PIVOT, 0.0036, 0.0205), { color: STEEL }),
      part('pin', 'steel', pin([0.224, 0.003], 0.0022, 0.0195), { color: STEEL }),
    ],
    grip: [0.18, 0],
    center: [0.118, 0],
    pivot: [0.18, 0],
    hold: 'forward',
  };
}

// ---------- Huntsman ----------

function huntsman(): KnifeModel {
  const grip = '#2f3a2b';
  return {
    skin: 'huntsman',
    name: 'Huntsman Knife',
    parts: [
      part(
        'blade',
        'blade',
        blade({
          // A deep swedged clip, then a saw along the back.
          spine: [
            [0, 0],
            [0.02, 0.0045],
            [0.045, 0.011],
            [0.07, 0.0185],
            [0.082, 0.021],
            ...saw(0.088, 7, 0.0108, 0.021, 0.0062),
            [0.18, 0.021],
            [0.19, 0.021],
          ],
          edge: [
            [0, 0],
            [0.01, -0.011],
            [0.03, -0.019],
            [0.06, -0.0225],
            [0.15, -0.0225],
            [0.175, -0.0205],
            [0.19, -0.02],
          ],
          thickness: BLADE * 1.2,
          grind: 0.4,
        }),
      ),
      part(
        'guard',
        'metal',
        slab(
          [
            [0.19, 0.03],
            [0.194, 0.033],
            [0.199, 0.03],
            [0.199, -0.032],
            [0.194, -0.036],
            [0.19, -0.032],
          ],
          0.016,
          { bevel: 0.0022 },
        ),
      ),
      part(
        'handle',
        'grip',
        slab(
          [
            [0.199, 0.018],
            [0.24, 0.0205],
            [0.29, 0.0195],
            [0.31, 0.0165],
            [0.316, 0.0105],
            [0.316, -0.012],
            [0.31, -0.0185],
            [0.29, -0.0215],
            [0.279, -0.0172],
            [0.267, -0.0222],
            [0.255, -0.0172],
            [0.243, -0.0222],
            [0.231, -0.0172],
            [0.219, -0.0222],
            [0.206, -0.0192],
            [0.199, -0.0172],
          ],
          0.024,
          { bevel: 0.004 },
        ),
        { color: grip },
      ),
      part(
        'pommel',
        'steel',
        slab(
          [
            [0.315, 0.0165],
            [0.324, 0.0135],
            [0.327, 0],
            [0.324, -0.0145],
            [0.315, -0.0175],
          ],
          0.026,
          { bevel: 0.003 },
        ),
        { color: STEEL },
      ),
    ],
    grip: [0.257, 0],
    center: [0.163, 0],
    pivot: [0.257, 0],
    hold: 'forward',
  };
}

// ---------- Falchion ----------

function falchion(): KnifeModel {
  const grip = '#1b1c1f';
  return {
    skin: 'falchion',
    name: 'Falchion Knife',
    parts: [
      part(
        'blade',
        'blade',
        blade({
          // A sabre's curve: a long clipped back over a full belly.
          spine: [
            [0, 0],
            [0.03, 0.0065],
            [0.06, 0.0125],
            [0.1, 0.0175],
            [0.14, 0.0195],
            [0.17, 0.0195],
          ],
          edge: [
            [0, 0],
            [0.008, -0.01],
            [0.025, -0.0195],
            [0.055, -0.0255],
            [0.095, -0.0265],
            [0.135, -0.0225],
            [0.17, -0.0175],
          ],
          thickness: BLADE * 1.1,
          grind: 0.38,
        }),
      ),
      part(
        'guard',
        'metal',
        slab(
          [
            [0.169, 0.024],
            [0.177, 0.025],
            [0.177, -0.022],
            [0.172, -0.03],
            [0.165, -0.029],
            [0.169, -0.02],
          ],
          0.015,
          { bevel: 0.002 },
        ),
      ),
      part(
        'handle',
        'grip',
        slab(
          [
            [0.177, 0.0195],
            [0.21, 0.0185],
            [0.25, 0.0145],
            [0.282, 0.009],
            [0.295, 0.004],
            [0.299, -0.006],
            [0.293, -0.022],
            [0.283, -0.031],
            [0.274, -0.026],
            [0.258, -0.021],
            [0.236, -0.02],
            [0.222, -0.023],
            [0.206, -0.019],
            [0.188, -0.021],
            [0.177, -0.017],
          ],
          0.022,
          { bevel: 0.0035 },
        ),
        { color: grip },
      ),
      ...bands('ridge', [0.2, 0.218, 0.236, 0.254], 0.0034, -0.0205, 0.0175, 0.0235, '#2c2d31'),
      part('pommelPin', 'steel', pin([0.284, -0.016], 0.0034, 0.0235), { color: STEEL }),
    ],
    grip: [0.236, -0.002],
    center: [0.148, 0],
    pivot: [0.236, -0.002],
    hold: 'forward',
  };
}

// ---------- Gut knife ----------

function gut(): KnifeModel {
  const grip = '#202126';
  return {
    skin: 'gut',
    name: 'Gut Knife',
    parts: [
      part(
        'blade',
        'blade',
        blade({
          // An upswept point, then the hook cut into the back behind it.
          spine: [
            [0, 0],
            [0.01, 0.007],
            [0.02, 0.0125],
            [0.0235, 0.0105],
            [0.027, 0.004],
            [0.033, 0.0012],
            [0.04, 0.0015],
            [0.046, 0.0055],
            [0.05, 0.0125],
            [0.062, 0.0142],
            [0.1, 0.0145],
            [0.136, 0.014],
          ],
          edge: [
            [0, 0],
            [0.006, -0.006],
            [0.018, -0.0135],
            [0.04, -0.0185],
            [0.08, -0.02],
            [0.12, -0.019],
            [0.136, -0.018],
          ],
          thickness: BLADE * 1.1,
          grind: 0.32,
        }),
      ),
      part(
        'guard',
        'metal',
        slab(
          [
            [0.135, 0.0175],
            [0.142, 0.0175],
            [0.142, -0.024],
            [0.137, -0.028],
            [0.131, -0.026],
            [0.135, -0.02],
          ],
          0.013,
          { bevel: 0.0018 },
        ),
      ),
      part(
        'handle',
        'grip',
        slab(
          [
            [0.142, 0.0155],
            [0.2, 0.0165],
            [0.24, 0.0155],
            [0.254, 0.011],
            [0.257, 0],
            [0.254, -0.012],
            [0.24, -0.0172],
            [0.228, -0.0148],
            [0.217, -0.0195],
            [0.206, -0.0148],
            [0.195, -0.0195],
            [0.184, -0.0148],
            [0.173, -0.0195],
            [0.16, -0.017],
            [0.142, -0.0165],
          ],
          0.02,
          { bevel: 0.0032, holes: [arc([0.244, 0], 0.0036, 8).reverse()] },
        ),
        { color: grip },
      ),
      part('pin0', 'steel', pin([0.158, 0], 0.0022, 0.0205), { color: STEEL }),
      part('pin1', 'steel', pin([0.222, 0.002], 0.0022, 0.0205), { color: STEEL }),
    ],
    grip: [0.198, -0.001],
    center: [0.128, 0],
    pivot: [0.198, -0.001],
    hold: 'forward',
  };
}

// ---------- Talon ----------

function talon(): KnifeModel {
  const grip = '#1e1f24';
  return {
    skin: 'talon',
    name: 'Talon Knife',
    parts: [
      part(
        'blade',
        'blade',
        blade({
          // A long hawkbill: a gentler, longer claw than the karambit's.
          spine: [
            [0, 0],
            [0.004, 0.011],
            [0.012, 0.024],
            [0.026, 0.037],
            [0.046, 0.048],
            [0.072, 0.056],
            [0.1, 0.06],
            [0.13, 0.062],
          ],
          edge: [
            [0, 0],
            [0.012, 0.009],
            [0.028, 0.018],
            [0.048, 0.026],
            [0.072, 0.032],
            [0.1, 0.035],
            [0.13, 0.036],
          ],
          thickness: BLADE,
          grind: 0.46,
        }),
      ),
      part(
        'flipper',
        'blade',
        slab(
          [
            [0.124, 0.035],
            [0.136, 0.035],
            [0.14, 0.03],
            [0.132, 0.024],
            [0.124, 0.027],
          ],
          BLADE,
          { bevel: 0 },
        ),
      ),
      part(
        'handle',
        'grip',
        slab(
          [
            [0.128, 0.065],
            [0.16, 0.067],
            [0.2, 0.068],
            [0.226, 0.066],
            [0.236, 0.06],
            [0.236, 0.045],
            [0.226, 0.04],
            [0.21, 0.042],
            [0.198, 0.038],
            [0.186, 0.042],
            [0.174, 0.038],
            [0.162, 0.042],
            [0.146, 0.037],
            [0.128, 0.035],
          ],
          0.017,
          { bevel: 0.0026 },
        ),
        { color: grip },
      ),
      part(
        'liner',
        'metal',
        slab(
          [
            [0.13, 0.0655],
            [0.2, 0.0685],
            [0.226, 0.0665],
            [0.226, 0.0625],
            [0.2, 0.0645],
            [0.13, 0.0615],
          ],
          0.0185,
          { bevel: 0.0008 },
        ),
      ),
      part('ring', 'metal', ring([0.258, 0.053], 0.026, 0.0168, 0.012, 16)),
      part('pin0', 'steel', pin([0.135, 0.05], 0.0032, 0.019), { color: STEEL }),
      part('pin1', 'steel', pin([0.214, 0.055], 0.0024, 0.019), { color: STEEL }),
    ],
    grip: [0.19, 0.052],
    center: [0.14, 0.04],
    pivot: [0.258, 0.053],
    hold: 'forward',
  };
}

// ---------- Skeleton ----------

function skeleton(): KnifeModel {
  const cord = '#3a4430';
  return {
    skin: 'skeleton',
    name: 'Skeleton Knife',
    parts: [
      part(
        'blade',
        'blade',
        blade({
          spine: [
            [0, 0],
            [0.022, 0.0085],
            [0.05, 0.0135],
            [0.122, 0.0145],
          ],
          edge: [
            [0, 0],
            [0.012, -0.01],
            [0.035, -0.0155],
            [0.105, -0.016],
            [0.122, -0.0155],
          ],
          thickness: BLADE * 1.1,
          grind: 0.4,
        }),
      ),
      // The frame is the tang itself, cut out to a skeleton and ending in a finger loop.
      part(
        'frame',
        'metal',
        slab(
          [
            [0.12, 0.0145],
            [0.205, 0.0135],
            [0.216, 0.0165],
            [0.232, 0.0185],
            [0.2465, 0.0115],
            [0.2505, 0],
            [0.2465, -0.0115],
            [0.232, -0.0185],
            [0.216, -0.0165],
            [0.205, -0.0145],
            [0.12, -0.0155],
          ],
          BLADE * 1.3,
          {
            bevel: 0.0012,
            // The loop takes a finger, which the knife hangs from when spun.
            holes: [slot(0.134, 0.206, -0.0075, 0.0065), arc([0.231, 0], 0.0102, 12).reverse()],
          },
        ),
      ),
      ...[0.15, 0.156, 0.162, 0.168, 0.174, 0.18, 0.186].map((z, i) =>
        part(
          `cord${i}`,
          'accent',
          slab(
            [
              [z, -0.016],
              [z + 0.0046, -0.0163],
              [z + 0.0052 + (i % 2) * 0.001, 0.0153],
              [z + 0.0006 + (i % 2) * 0.001, 0.0156],
            ],
            0.0115,
            { bevel: 0.0016 },
          ),
          { color: cord },
        ),
      ),
    ],
    grip: [0.17, 0],
    center: [0.125, 0],
    pivot: [0.231, 0],
    hold: 'forward',
  };
}

// ---------- Stiletto ----------

const STILETTO_PIVOT: V2 = [0.138, 0];

function stiletto(): KnifeModel {
  const grip = '#2a2220';
  const bladeJoint: Joint = { channel: 'a', pivot: STILETTO_PIVOT, sign: -1 };
  return {
    skin: 'stiletto',
    name: 'Stiletto Knife',
    parts: [
      part(
        'blade',
        'blade',
        blade({
          // Long and slim, a swedge along the back to the needle point.
          spine: [
            [0, 0],
            [0.03, 0.0072],
            [0.062, 0.0094],
            [0.134, 0.01],
          ],
          edge: [
            [0, 0],
            [0.02, -0.0072],
            [0.05, -0.0102],
            [0.134, -0.0105],
          ],
          thickness: BLADE * 0.95,
          grind: 0.48,
        }),
        { joint: bladeJoint },
      ),
      part(
        'bolster',
        'metal',
        slab(
          [
            [0.13, 0.0118],
            [0.136, 0.0118],
            [0.139, 0.0165],
            [0.143, 0.0165],
            [0.146, 0.0112],
            [0.146, -0.0112],
            [0.143, -0.017],
            [0.139, -0.017],
            [0.136, -0.0122],
            [0.13, -0.0122],
          ],
          0.0155,
          { bevel: 0.0018 },
        ),
      ),
      part(
        'handle',
        'grip',
        slab(
          [
            [0.146, 0.0105],
            [0.18, 0.0118],
            [0.22, 0.0118],
            [0.25, 0.0102],
            [0.25, -0.0102],
            [0.22, -0.0118],
            [0.18, -0.0118],
            [0.146, -0.0105],
          ],
          0.015,
          { bevel: 0.003 },
        ),
        { color: grip },
      ),
      part(
        'cap',
        'metal',
        slab(
          [
            [0.249, 0.0108],
            [0.257, 0.0098],
            [0.262, 0.004],
            [0.262, -0.004],
            [0.257, -0.0098],
            [0.249, -0.0108],
          ],
          0.0155,
          { bevel: 0.002 },
        ),
      ),
      part('button', 'steel', box(0.165, 0.175, 0.0108, 0.0132, 0.006, { bevel: 0.0008 }), {
        color: STEEL,
      }),
    ],
    grip: [0.2, 0],
    center: [0.13, 0],
    pivot: [0.2, 0],
    hold: 'forward',
  };
}

/**
 * Each knife's builder, and how much it is scaled up from life: every knife is drawn about as long
 * as the chef's knife, so a karambit reads in the hand and across the room as well as a bayonet.
 */
const BUILDERS: Readonly<Record<KnifeSkin, readonly [() => KnifeModel, number]>> = {
  kitchen: [kitchen, 1],
  karambit: [karambit, 1.3],
  butterfly: [butterfly, 1.08],
  m9: [m9, 1],
  bayonet: [bayonet, 1],
  flip: [flip, 1.25],
  huntsman: [huntsman, 1],
  falchion: [falchion, 1.04],
  gut: [gut, 1.15],
  talon: [talon, 1.12],
  skeleton: [skeleton, 1.2],
  stiletto: [stiletto, 1.15],
};

/** A model scaled up about its tip, outlines, hinges and all. */
function scaled(model: KnifeModel, k: number): KnifeModel {
  if (k === 1) return model;
  const v = ([z, y]: V2): V2 => [z * k, y * k];
  return {
    ...model,
    parts: model.parts.map((p) => {
      p.geometry.scale(k, k, k);
      return {
        ...p,
        outline: p.outline.map((loop) => ({ ...loop, points: loop.points.map(v) })),
        ...(p.joint ? { joint: { ...p.joint, pivot: v(p.joint.pivot) } } : {}),
      };
    }),
    grip: v(model.grip),
    center: v(model.center),
    pivot: v(model.pivot),
  };
}

const models = new Map<KnifeSkin, KnifeModel>();

/** A knife's model, built the first time it is asked for and shared after that. */
export function knifeModel(skin: KnifeSkin): KnifeModel {
  let model = models.get(skin);
  if (!model) {
    const [build, scale] = BUILDERS[skin];
    model = scaled(build(), scale);
    models.set(skin, model);
  }
  return model;
}
