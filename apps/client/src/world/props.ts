import { Color, ExtrudeGeometry, Shape, Vector3 } from 'three';
import {
  COUNTER_HEIGHT,
  HEAT_LAMP_HOUSING_Y,
  HEAT_LAMP_SHADE,
  KITCHEN,
  PASS_DISHES,
  STATIONS,
  createRandom,
  type DishId,
  type StationId,
} from '@world/shared';
import { at } from './builder.ts';
import { paint, shadeGeometry, type Kit, type LayerName } from './kit.ts';
import { croissantGeometry, flatbreadGeometry, pipedKiss, wedgeGeometry } from './foodShapes.ts';
import { plateProfile } from './kitchen.ts';

/**
 * The centerpiece of each station: what a cook at that station would have in front of them, turned
 * and modeled at its real size, and the five dishes waiting on the pass. Positions match the
 * station centers in the shared layout; the bigger pieces (pots, pans, boards, the chicken, the
 * cloche, the croquembouche, the mixer) keep to the knife solids there, within a centimeter or two.
 */

const TOP = COUNTER_HEIGHT;
/** Height of a cooking zone's cast iron plate. */
const ZONE = TOP + 0.01;
/** Heat lamp bulbs glow brighter than any paint, so their color goes past 1. */
const BULB = new Color(paint.bulb).multiplyScalar(1.4);
/** A heat lamp shade with a thin wall, so it reads from above and below. */
const LAMP_SHADE = shadeGeometry(HEAT_LAMP_SHADE, 40);
const croissant = croissantGeometry();

/** Bright tin, the lining of copper pans: steel's layer, polished. */
const TIN = '#e8e6e2';
const POLISHED = 0.55;
const CAST_IRON = '#2c2a28';
/** The pass's plates: porcelain a shade off white, so under a heat lamp the food, not the plate, is what shines. */
const PASS_PLATE = '#e6e0d5';

type Profile = [number, number][];

/** An open gas burner: a cap on its crown, a cast iron grate, and flames. Returns where a pan sits. */
function burner(kit: Kit, x: number, z: number, size = 1): number {
  kit.lathe(
    'iron',
    x,
    ZONE,
    z,
    [
      [0.001, 0],
      [0.075 * size, 0],
      [0.075 * size, 0.014],
      [0.066 * size, 0.022],
      [0.03 * size, 0.026],
      [0.001, 0.027],
    ],
    { color: CAST_IRON },
  );
  kit.add(
    'iron',
    kit.torus(0.17 * size, 0.012),
    at(x, ZONE + 0.05, z, { rx: Math.PI / 2 }),
    CAST_IRON,
    {
      uv: 'own',
    },
  );
  for (const ry of [0, Math.PI / 2])
    kit.rounded('iron', x, ZONE + 0.05, z, 0.4 * size, 0.022, 0.022, 0.006, CAST_IRON, { ry });
  kit.burner(x, ZONE + 0.022, z, 0.07 * size);
  return ZONE + 0.062;
}

/**
 * A pot or pan turned in section: a flat base easing into straight walls, a rolled rim, and its
 * inside, in `inner`'s layer if that differs (tin inside copper). `radius` and `height` are the
 * outside's; the wall is a few millimeters thick.
 */
function vessel(
  kit: Kit,
  layer: LayerName,
  x: number,
  y: number,
  z: number,
  radius: number,
  height: number,
  options: {
    inner?: LayerName;
    innerColor?: string;
    color?: string;
    finish?: number;
    depthScale?: number;
    flare?: number;
  } = {},
): void {
  const flare = options.flare ?? 1;
  const top = radius * flare;
  const wall = 0.004;
  const outside: Profile = [
    [0.001, 0],
    [radius - 0.014, 0],
    [radius - 0.004, 0.004],
    [radius, 0.016],
    [top, height - 0.008],
    [top + 0.0035, height - 0.003],
    [top + 0.003, height],
    [top - wall * 0.5, height + 0.0015],
  ];
  const inside: Profile = [
    [top - wall, height - 0.002],
    [top - wall, height - 0.01],
    [radius - wall, 0.018],
    [radius - wall - 0.01, wall + 0.002],
    [0.001, wall + 0.002],
  ];
  const look = { color: options.color, finish: options.finish, depthScale: options.depthScale };
  if (!options.inner) {
    kit.lathe(layer, x, y, z, [...outside, ...inside], look);
    return;
  }
  kit.lathe(layer, x, y, z, [...outside, inside[0]!], look);
  kit.lathe(options.inner, x, y, z, inside, {
    color: options.innerColor,
    finish: POLISHED,
    depthScale: options.depthScale,
  });
}

/** What is cooking in a pot: its surface at `level`, filling the inside. */
function contents(
  kit: Kit,
  x: number,
  y: number,
  z: number,
  radius: number,
  color: string,
  finish: number,
  depthScale = 1,
): void {
  kit.cylinder('food', x, y - 0.003, z, radius, 0.003, { color, finish, depthScale });
}

/** Two loop handles riveted to a pot's sides, across x, at height `y`. */
function loopHandles(
  kit: Kit,
  layer: LayerName,
  x: number,
  y: number,
  z: number,
  radius: number,
  color?: string,
): void {
  const loop = kit.torus(0.045, 0.008, Math.PI);
  for (const side of [-1, 1]) {
    // A half ring standing out from the wall, its ends riveted to it.
    kit.add(
      layer,
      loop,
      at(x + side * radius, y, z, { ry: side < 0 ? Math.PI : 0, rz: -Math.PI / 2 }),
      color,
      {
        uv: 'own',
        finish: POLISHED,
      },
    );
    for (const dz of [-0.045, 0.045]) {
      kit.sphere(layer, x + side * (radius + 0.002), y, z + dz, 0.007, { color, finish: POLISHED });
    }
  }
}

/** A long cast iron handle from a pan's rim toward `dir` (radians, 0 = +X), tapering, a hole at its end. */
function longHandle(kit: Kit, x: number, y: number, z: number, radius: number, dir: number): void {
  const length = 0.24 + radius;
  const hx = x + Math.cos(dir) * (radius + length / 2);
  const hz = z - Math.sin(dir) * (radius + length / 2);
  kit.rounded('iron', hx, y, hz, length, 0.016, 0.026, 0.006, CAST_IRON, {
    ry: dir,
    rz: 0.12,
    finish: 0.8,
  });
  // Riveted to the pan.
  for (const side of [-1, 1]) {
    const rx = x + Math.cos(dir) * (radius + 0.012) + Math.sin(dir) * side * 0.008;
    const rz = z - Math.sin(dir) * (radius + 0.012) + Math.cos(dir) * side * 0.008;
    kit.sphere('copper', rx, y + 0.004, rz, 0.0045);
  }
}

/** A copper saucepan with a tin lining and a long iron handle toward `handleDir`. */
function saucepan(
  kit: Kit,
  x: number,
  y: number,
  z: number,
  radius: number,
  height: number,
  handleDir: number,
  sauce: string,
): void {
  vessel(kit, 'copper', x, y, z, radius, height, { inner: 'steel', innerColor: TIN });
  contents(kit, x, y + height - 0.012, z, radius - 0.005, sauce, 0.25);
  longHandle(kit, x, y + height * 0.85, z, radius, handleDir);
}

/** A balloon whisk: a handle, and four loops of wire through its end and its tip. */
function whisk(kit: Kit, from: Vector3, to: Vector3): void {
  const axis = new Vector3().subVectors(to, from);
  const length = axis.length();
  axis.normalize();
  const handleEnd = from.clone().addScaledVector(axis, length * 0.42);
  const reach = length * 0.58;
  kit.rod('steel', from, handleEnd, 0.009, undefined, undefined, POLISHED);
  const side = new Vector3(0, 1, 0).cross(axis).normalize();
  const up = new Vector3().crossVectors(axis, side).normalize();
  const steps = 16;
  for (let w = 0; w < 4; w++) {
    const a = (w / 4) * Math.PI;
    const out = side.clone().multiplyScalar(Math.cos(a)).addScaledVector(up, Math.sin(a));
    let last = handleEnd.clone();
    for (let s = 1; s <= steps; s++) {
      // A teardrop through the handle's end and the tip, widest two thirds of the way along.
      const phi = (s / steps) * Math.PI * 2;
      const along = reach * 0.5 * (1 - Math.cos(phi));
      const wide = 0.04 * Math.sin(phi) * (0.35 + 0.65 * (along / reach));
      const point = handleEnd.clone().addScaledVector(axis, along).addScaledVector(out, wide);
      kit.rod('steel', last, point, 0.0013, 5, undefined, POLISHED);
      last = point;
    }
  }
}

/** Saucier: copper saucepans on the French top, the sauce for every plate. */
function saucier(kit: Kit): void {
  const cx = -2.6;
  const cz = -0.75;
  // French top: concentric cast iron rings over a hidden flame.
  for (const r of [0.12, 0.24, 0.36]) {
    kit.add('iron', kit.torus(r, 0.007), at(cx, ZONE + 0.002, cz, { rx: Math.PI / 2 }), CAST_IRON, {
      uv: 'own',
    });
  }
  kit.cylinder('iron', cx, ZONE, cz, 0.05, 0.01, { color: CAST_IRON });
  // Handles point north, toward the cook.
  saucepan(kit, cx - 0.36, ZONE, cz + 0.05, 0.13, 0.12, Math.PI / 2 + 0.3, '#6e2a10');
  saucepan(kit, cx + 0.05, ZONE, cz + 0.12, 0.17, 0.15, Math.PI / 2, '#a8682a');
  saucepan(kit, cx + 0.45, ZONE, cz - 0.05, 0.11, 0.1, Math.PI / 2 - 0.3, '#e9d9a6');
  kit.steamFrom(cx + 0.05, ZONE + 0.17, cz + 0.12, 1.1);
  // A whisk resting in the biggest pan, and a ladle in a bain-marie.
  whisk(
    kit,
    new Vector3(cx + 0.22, ZONE + 0.42, cz - 0.02),
    new Vector3(cx + 0.04, ZONE + 0.12, cz + 0.13),
  );
  vessel(kit, 'steel', cx - 0.75, ZONE, cz - 0.15, 0.09, 0.16, { finish: POLISHED });
  contents(kit, cx - 0.75, ZONE + 0.145, cz - 0.15, 0.085, '#f0e6c8', 0.3);
  kit.rod(
    'steel',
    new Vector3(cx - 0.76, ZONE + 0.1, cz - 0.16),
    new Vector3(cx - 0.8, ZONE + 0.36, cz - 0.3),
    0.006,
    undefined,
    undefined,
    POLISHED,
  );
  kit.sphere('steel', cx - 0.755, ZONE + 0.1, cz - 0.155, 0.035, { sy: 0.5, finish: POLISHED });
}

/** Poissonnier: a whole sea bass on a steel tray, lemons and herbs, a copper fish kettle on the flame. */
function poissonnier(kit: Kit): void {
  const cx = 2.6;
  const cz = -0.75;
  kit.rounded('steel', cx - 0.15, ZONE + 0.01, cz + 0.025, 0.7, 0.02, 0.35, 0.006, undefined, {
    finish: POLISHED,
  });
  fish(kit, cx - 0.15, ZONE + 0.058, cz + 0.03);
  // Lemon halves, cut face up, and a bunch of parsley.
  for (const [dx, dz] of [
    [-0.42, -0.08],
    [-0.3, -0.1],
  ] as const) {
    kit.sphere('food', cx + dx, ZONE + 0.02, cz + dz, 0.035, {
      sy: 0.7,
      color: '#f0c932',
      finish: 0.6,
    });
    kit.cylinder('food', cx + dx, ZONE + 0.044, cz + dz, 0.031, 0.002, {
      color: '#f6e7a0',
      finish: 0.5,
    });
  }
  const random = createRandom(23);
  for (let i = 0; i < 9; i++) {
    kit.sphere(
      'food',
      cx + 0.03 + random() * 0.12,
      ZONE + 0.03,
      cz - 0.1 + random() * 0.06,
      0.014,
      {
        sy: 0.6,
        color: random() < 0.5 ? '#3f7a2a' : '#4f8f33',
        finish: 1.1,
      },
    );
  }
  // The kettle: a long oval copper pan with a tin lining and brass handles, lid set ajar.
  const kx = cx + 0.55;
  const ky = burner(kit, kx, cz + 0.1);
  vessel(kit, 'copper', kx, ky, cz + 0.1, 0.32, 0.13, {
    inner: 'steel',
    innerColor: TIN,
    depthScale: 0.42,
  });
  kit.lathe(
    'copper',
    kx - 0.04,
    ky + 0.133,
    cz + 0.1,
    [
      [0.001, 0.028],
      [0.12, 0.024],
      [0.25, 0.012],
      [0.3, 0.003],
      [0.312, 0],
      [0.312, -0.006],
      [0.3, -0.004],
      [0.001, 0.02],
    ],
    { depthScale: 0.4, rz: 0.035 },
  );
  kit.lathe('brass', kx - 0.04, ky + 0.152, cz + 0.1, [
    [0.001, 0],
    [0.012, 0],
    [0.008, 0.02],
    [0.02, 0.032],
    [0.001, 0.036],
  ]);
  for (const dx of [-0.34, 0.34])
    kit.rounded('brass', kx + dx, ky + 0.1, cz + 0.1, 0.06, 0.016, 0.05, 0.006);
  kit.steamFrom(kx + 0.22, ky + 0.15, cz + 0.1, 0.8);
}

/** A whole fish lying on its side: a tapering body, a forked tail, fins, an eye. */
function fish(kit: Kit, x: number, y: number, z: number): void {
  // Silver flanks, a blue-grey back.
  kit.sphere('food', x, y, z, 0.06, {
    sx: 4.4,
    sy: 0.75,
    sz: 1.35,
    color: '#b8c4c9',
    finish: 0.35,
  });
  kit.sphere('food', x - 0.01, y + 0.01, z - 0.004, 0.055, {
    sx: 4.1,
    sy: 0.6,
    sz: 1.05,
    color: '#4b5d68',
    finish: 0.4,
  });
  // The head, a little blunter, and the eye.
  kit.sphere('food', x - 0.21, y - 0.002, z, 0.05, {
    sx: 1.25,
    sy: 0.72,
    sz: 1.2,
    color: '#aab6bc',
    finish: 0.35,
  });
  kit.sphere('gloss', x - 0.235, y + 0.029, z + 0.012, 0.009, {
    sy: 0.6,
    color: '#0e0f10',
    finish: 0.2,
  });
  kit.add(
    'gloss',
    kit.torus(0.0105, 0.0022),
    at(x - 0.235, y + 0.0295, z + 0.012, { rx: -Math.PI / 2 }),
    '#d9d2b8',
    {
      uv: 'own',
      finish: 0.4,
    },
  );
  // A forked tail and the fins, thin and translucent at their edges.
  const tail = new Shape();
  tail.moveTo(0, 0);
  tail.lineTo(0.085, 0.055);
  tail.quadraticCurveTo(0.07, 0, 0.085, -0.055);
  tail.lineTo(0, 0);
  const tailGeometry = new ExtrudeGeometry(tail, { depth: 0.003, bevelEnabled: false });
  kit.add('food', tailGeometry, at(x + 0.25, y - 0.004, z, { rx: Math.PI / 2 }), '#7d8b92', {
    finish: 0.6,
  });
  const fin = new Shape();
  fin.moveTo(0, 0);
  fin.quadraticCurveTo(0.04, 0.035, 0.1, 0.012);
  fin.lineTo(0.11, 0);
  fin.lineTo(0, 0);
  const finGeometry = new ExtrudeGeometry(fin, { depth: 0.003, bevelEnabled: false });
  // The dorsal fin, lying along its back edge on the tray.
  kit.add(
    'food',
    finGeometry,
    at(x - 0.06, y - 0.012, z - 0.072, { rx: -Math.PI / 2 + 0.15 }),
    '#5d6b73',
    { finish: 0.6 },
  );
  // The gill's edge.
  kit.add(
    'food',
    kit.torus(0.04, 0.003, 1.8),
    at(x - 0.18, y + 0.03, z, { rx: -Math.PI / 2, rz: -0.9 }),
    '#8e9aa0',
    {
      uv: 'own',
      finish: 0.5,
    },
  );
}

/** Rôtisseur: a golden roast chicken resting in a copper roasting pan, steaks on the plancha. */
function rotisseur(kit: Kit): void {
  const cx = 2.6;
  const cz = 0.75;
  // Plancha for searing, beside the roast, three steaks on it.
  kit.rounded('steel', cx + 0.65, ZONE + 0.015, cz, 0.6, 0.03, 0.8, 0.006, undefined, {
    finish: 0.9,
  });
  kit.rounded('iron', cx + 0.65, ZONE + 0.031, cz, 0.54, 0.002, 0.74, 0.001, '#1f1d1c');
  for (let i = 0; i < 3; i++) {
    const sx = cx + 0.55 + (i % 2) * 0.18;
    const sz = cz - 0.2 + i * 0.18;
    kit.rounded('food', sx, ZONE + 0.047, sz, 0.12, 0.028, 0.085, 0.01, '#5c2414', {
      ry: 0.3 * i,
      finish: 0.7,
    });
    // A seared crust on top, and a rim of fat.
    kit.rounded('food', sx, ZONE + 0.0595, sz, 0.11, 0.004, 0.075, 0.002, '#3a160c', {
      ry: 0.3 * i,
      finish: 0.9,
    });
  }
  // Roasting pan: copper, its walls and handles rounded.
  const pan = { x0: cx - 0.32, x1: cx + 0.22, z0: cz - 0.2, z1: cz + 0.2 };
  kit.rounded('copper', (pan.x0 + pan.x1) / 2, ZONE + 0.01, cz, pan.x1 - pan.x0, 0.02, 0.4, 0.008);
  for (const [x0, x1, z0, z1] of [
    [pan.x0, pan.x1, pan.z0, pan.z0 + 0.02],
    [pan.x0, pan.x1, pan.z1 - 0.02, pan.z1],
    [pan.x0, pan.x0 + 0.02, pan.z0, pan.z1],
    [pan.x1 - 0.02, pan.x1, pan.z0, pan.z1],
  ] as const) {
    kit.rounded('copper', (x0 + x1) / 2, ZONE + 0.04, (z0 + z1) / 2, x1 - x0, 0.08, z1 - z0, 0.006);
  }
  kit.rounded(
    'steel',
    (pan.x0 + pan.x1) / 2,
    ZONE + 0.0205,
    cz,
    pan.x1 - pan.x0 - 0.04,
    0.002,
    0.36,
    0.001,
    TIN,
    { finish: POLISHED },
  );
  for (const dx of [-0.38, 0.28])
    kit.rounded('brass', cx + dx, ZONE + 0.06, cz, 0.06, 0.018, 0.12, 0.007);
  // Pan juices.
  kit.rounded(
    'food',
    (pan.x0 + pan.x1) / 2,
    ZONE + 0.024,
    cz,
    pan.x1 - pan.x0 - 0.05,
    0.004,
    0.34,
    0.002,
    '#6b3512',
    { finish: 0.2 },
  );
  chicken(kit, cx - 0.05, ZONE + 0.1, cz);
  // Garlic and thyme around it.
  for (let i = 0; i < 4; i++) {
    kit.sphere('food', cx - 0.25 + i * 0.13, ZONE + 0.045, cz + (i % 2 ? 0.14 : -0.14), 0.024, {
      sy: 0.85,
      color: '#efe4cc',
      finish: 0.7,
    });
  }
  for (let i = 0; i < 6; i++) {
    kit.rod(
      'food',
      new Vector3(cx - 0.27 + i * 0.07, ZONE + 0.04, cz - 0.15),
      new Vector3(cx - 0.22 + i * 0.07, ZONE + 0.042, cz - 0.05),
      0.0025,
      5,
      '#4d5f2e',
    );
  }
}

/** A roast chicken: a plump body, its breast, drumsticks with their bones and wings, skin lacquered gold. */
function chicken(kit: Kit, x: number, y: number, z: number): void {
  const skin = '#c27a35';
  const crisp = '#a9611f';
  kit.sphere('food', x, y, z, 0.12, { sx: 1.35, sy: 0.85, sz: 1.05, color: skin, finish: 0.45 });
  kit.sphere('food', x - 0.06, y + 0.045, z, 0.09, {
    sx: 1.1,
    sy: 0.75,
    sz: 1.2,
    color: '#d38d43',
    finish: 0.4,
  });
  // The breastbone's ridge.
  kit.sphere('food', x - 0.05, y + 0.1, z, 0.03, {
    sx: 2.4,
    sy: 0.4,
    sz: 0.6,
    color: '#c98238',
    finish: 0.4,
  });
  for (const side of [-1, 1]) {
    kit.sphere('food', x + 0.1, y - 0.01, z + side * 0.1, 0.05, {
      sx: 1.6,
      sy: 0.9,
      sz: 0.95,
      ry: side * -0.5,
      color: crisp,
      finish: 0.5,
    });
    // The drumstick's knuckle, bare.
    kit.sphere('food', x + 0.185, y - 0.004, z + side * 0.128, 0.016, {
      sx: 1.3,
      color: '#ece0c6',
      finish: 0.6,
    });
    kit.sphere('food', x - 0.03, y + 0.01, z + side * 0.13, 0.04, {
      sx: 1.4,
      sy: 0.6,
      sz: 0.8,
      ry: side * 0.4,
      color: crisp,
      finish: 0.5,
    });
  }
}

/** A carrot, tapering from its shoulder to the tip, along +x before it is turned. */
function carrot(kit: Kit, x: number, y: number, z: number, ry: number): void {
  kit.lathe(
    'food',
    x,
    y,
    z,
    [
      [0.001, 0],
      [0.006, 0.01],
      [0.012, 0.07],
      [0.018, 0.16],
      [0.02, 0.2],
      [0.017, 0.215],
      [0.001, 0.218],
    ],
    { color: '#e5742a', finish: 0.8, ry, rz: Math.PI / 2 },
  );
}

/** Entremetier: vegetables, soups and eggs. A stockpot on the boil and a board of carrots. */
function entremetier(kit: Kit): void {
  const cx = -2.6;
  const cz = 0.75;
  const potX = cx - 0.45;
  const py = burner(kit, potX, cz, 1.1);
  vessel(kit, 'steel', potX, py, cz, 0.21, 0.36, { finish: 0.9 });
  contents(kit, potX, py + 0.34, cz, 0.2, '#d8a24a', 0.25);
  loopHandles(kit, 'steel', potX, py + 0.3, cz, 0.21);
  kit.steamFrom(potX, py + 0.4, cz, 1.2);

  // Cutting board with carrots, a leek and a chef's knife.
  const bx = cx + 0.25;
  kit.rounded('wood', bx, ZONE + 0.015, cz + 0.02, 0.5, 0.03, 0.32, 0.006, paint.woodLight);
  const by = ZONE + 0.03;
  for (let i = 0; i < 3; i++) {
    carrot(kit, bx - 0.06, by + 0.02, cz - 0.07 + i * 0.06, 0.15 * i);
    // Its green top, cut short.
    kit.cylinder(
      'food',
      bx - 0.06 + Math.cos(0.15 * i) * 0.005,
      by + 0.012,
      cz - 0.07 + i * 0.06,
      0.006,
      0.02,
      {
        rz: Math.PI / 2,
        ry: 0.15 * i,
        color: '#5a8a32',
      },
    );
  }
  for (let i = 0; i < 6; i++) {
    kit.cylinder('food', bx + 0.06 + i * 0.014, by, cz + 0.06 + i * 0.012, 0.015, 0.005, {
      color: i % 2 ? '#e5742a' : '#ee8a3a',
      finish: 0.6,
    });
  }
  // The leek: white at the root, darkening to green.
  kit.cylinder('food', bx + 0.18, by + 0.025, cz - 0.08, 0.025, 0.12, {
    rz: Math.PI / 2,
    ry: 0.4,
    color: '#e8ecd8',
    finish: 0.7,
  });
  kit.cylinder(
    'food',
    bx + 0.18 - Math.cos(0.4) * 0.12,
    by + 0.025,
    cz - 0.08 + Math.sin(0.4) * 0.12,
    0.024,
    0.1,
    {
      rz: Math.PI / 2,
      ry: 0.4,
      color: '#6f9a45',
      finish: 0.8,
    },
  );
  // A chef's knife across the board: a blade and a riveted handle.
  kit.rounded('steel', bx + 0.08, by + 0.003, cz + 0.13, 0.22, 0.003, 0.045, 0.0012, undefined, {
    ry: -0.15,
    finish: POLISHED,
  });
  kit.rounded('gloss', bx - 0.07, by + 0.011, cz + 0.155, 0.11, 0.02, 0.024, 0.008, paint.rubber, {
    ry: -0.15,
    finish: 1.6,
  });
  // A bowl of eggs.
  kit.lathe(
    'gloss',
    cx + 0.75,
    ZONE,
    cz - 0.1,
    [
      [0.001, 0.004],
      [0.1, 0.004],
      [0.104, 0],
      [0.118, 0.002],
      [0.152, 0.064],
      [0.158, 0.07],
      [0.154, 0.074],
      [0.146, 0.068],
      [0.112, 0.012],
      [0.001, 0.012],
    ],
    { color: paint.porcelain, finish: 0.5 },
  );
  // A ring of eggs round the bowl, two more in the middle, filling it.
  for (let i = 0; i < 9; i++) {
    const a = (i / 7) * Math.PI * 2 + (i >= 7 ? 0.5 : 0);
    const r = i < 7 ? 0.085 : 0.03;
    kit.sphere(
      'food',
      cx + 0.75 + Math.cos(a) * r,
      ZONE + (i < 7 ? 0.055 : 0.062),
      cz - 0.1 + Math.sin(a) * r,
      0.028,
      {
        sy: 1.28,
        rz: 1.2,
        ry: a,
        color: i % 2 ? '#f2dcbe' : '#e7c7a1',
        finish: 0.9,
      },
    );
  }
}

/** The heart of the piano: a big stockpot and a copper rondeau, both on the boil. */
function pianoCenter(kit: Kit): void {
  const sy = burner(kit, -0.55, 0, 1.25);
  vessel(kit, 'steel', -0.55, sy, 0, 0.27, 0.46, { finish: 0.9 });
  contents(kit, -0.55, sy + 0.44, 0, 0.262, '#c99a4e', 0.2);
  loopHandles(kit, 'steel', -0.55, sy + 0.4, 0, 0.27);
  kit.steamFrom(-0.55, sy + 0.5, 0, 1.4);
  const ry = burner(kit, 0.6, 0, 1.25);
  vessel(kit, 'copper', 0.6, ry, 0, 0.3, 0.15, { inner: 'steel', innerColor: TIN });
  contents(kit, 0.6, ry + 0.135, 0, 0.292, '#7a3216', 0.3);
  loopHandles(kit, 'brass', 0.6, ry + 0.11, 0, 0.3);
  kit.steamFrom(0.6, ry + 0.18, 0, 0.9);

  // Salt in a wooden box, a pepper mill, side towels and a crock of utensils at the piano's ends.
  kit.rounded('wood', -4.3, TOP + 0.06, -0.4, 0.18, 0.12, 0.14, 0.008, paint.wood);
  kit.lathe(
    'wood',
    -4.3,
    TOP,
    0.2,
    [
      [0.001, 0],
      [0.03, 0],
      [0.031, 0.02],
      [0.026, 0.06],
      [0.028, 0.15],
      [0.024, 0.19],
      [0.012, 0.205],
      [0.006, 0.22],
      [0.001, 0.222],
    ],
    { color: '#5a3520' },
  );
  for (let i = 0; i < 4; i++) {
    kit.rounded('matte', -4.3, TOP + 0.012 + i * 0.022, 0.75, 0.3, 0.02, 0.24, 0.008, '#f4f1ea');
  }
  vessel(kit, 'steel', 4.3, TOP, 0.3, 0.13, 0.08, { flare: 1.4, finish: POLISHED });
  // Packed with utensils: their dark ends, all but filling it.
  kit.cylinder('iron', 4.3, TOP + 0.064, 0.3, 0.17, 0.002, { color: '#24211f' });
  for (let i = 0; i < 5; i++) {
    const tip = new Vector3(4.24 + i * 0.03, TOP + 0.22, 0.25 + i * 0.02);
    kit.rod(
      'steel',
      new Vector3(4.3 + (i - 2) * 0.012, TOP + 0.02, 0.3),
      tip,
      0.004,
      undefined,
      undefined,
      POLISHED,
    );
    if (i % 2 === 0)
      kit.sphere('steel', tip.x, tip.y, tip.z, 0.022, { sy: 0.45, finish: POLISHED });
    else kit.rounded('wood', tip.x, tip.y, tip.z, 0.014, 0.05, 0.03, 0.006, paint.woodLight);
  }
}

/** A plain round plate. Returns the height its food sits on. */
function plate(kit: Kit, x: number, z: number, radius: number, color: string): number {
  kit.lathe('gloss', x, TOP, z, plateProfile(radius, 0.022), { color, finish: 0.6 });
  return TOP + 0.011;
}

/** A point `along` the axis at angle `ry` from (x, z), and `across` it. */
function onAxis(x: number, z: number, ry: number, along: number, across = 0): [number, number] {
  return [
    x + Math.cos(ry) * along + Math.sin(ry) * across,
    z - Math.sin(ry) * along + Math.cos(ry) * across,
  ];
}

/** Kamcentre Roast Goose, Hong Kong: char siu, lacquered and charred at the edges, sliced. */
function charSiu(kit: Kit, x: number, z: number): void {
  const y = plate(kit, x, z, 0.19, PASS_PLATE);
  // A glossy pool of the glaze under the slices.
  kit.cylinder('food', x + 0.015, y, z + 0.015, 0.11, 0.002, { color: '#4a130c', finish: 0.15 });
  const random = createRandom(7);
  const ry = 0.5;
  for (let i = 0; i < 7; i++) {
    // Thick slices shingled along the plate, each lying on the last: the cut face pink-brown,
    // ringed by the lacquered red of the outside and charred at its corners.
    const along = -0.1 + i * 0.032;
    const [cx, cz] = onAxis(x, z, ry, along, (random() - 0.5) * 0.008);
    const turn = ry + (random() - 0.5) * 0.12;
    const lean = 1.2;
    const cy = y + 0.02;
    kit.rounded('food', cx, cy, cz, 0.012, 0.05, 0.085, 0.005, '#6a1a10', {
      ry: turn,
      rz: lean,
      finish: 0.3,
    });
    const [fx, fz] = onAxis(cx, cz, turn, Math.cos(lean) * 0.0055);
    kit.rounded(
      'food',
      fx,
      cy + Math.sin(lean) * 0.0055,
      fz,
      0.002,
      0.038,
      0.072,
      0.001,
      '#b06e5c',
      {
        ry: turn,
        rz: lean,
        finish: 1,
      },
    );
    for (const end of [-1, 1]) {
      const [ex, ez] = onAxis(cx, cz, turn, -0.004, end * 0.041);
      kit.sphere('food', ex, cy + 0.016, ez, 0.007, { sy: 0.6, color: '#1c0b07', finish: 0.6 });
    }
  }
  // Sesame and scallion.
  for (let i = 0; i < 16; i++) {
    const [sx, sz] = onAxis(x, z, ry, (random() - 0.5) * 0.22, (random() - 0.5) * 0.06);
    kit.sphere('food', sx, y + 0.05, sz, 0.0025, {
      sx: 1.8,
      ry: random() * 3,
      color: '#f2e6c8',
      finish: 0.8,
    });
  }
  for (let i = 0; i < 7; i++) {
    const [sx, sz] = onAxis(x, z, ry, (random() - 0.5) * 0.2, (random() - 0.5) * 0.05);
    kit.cylinder('food', sx, y + 0.047, sz, 0.004, 0.003, { color: '#5f9a3a', finish: 0.7 });
  }
}

/**
 * The Four Horsemen, Brooklyn: glazed beetroot with La Tur, in a pool of its own reduced juices.
 * The beet is deep crimson, its glaze dark and glossy, the pool almost black-red where it is deep.
 */
function beetroot(kit: Kit, x: number, z: number): void {
  const y = plate(kit, x, z, 0.19, PASS_PLATE);
  kit.cylinder('food', x, y, z, 0.12, 0.003, { color: '#3c0716', finish: 0.12 });
  kit.cylinder('food', x - 0.01, y, z + 0.01, 0.135, 0.0015, { color: '#5b0d24', finish: 0.15 });
  // Glazed halves, cut face down, their skins nearly black-red.
  const halves: [number, number, number][] = [
    [-0.07, 0.05, 0.05],
    [-0.06, -0.06, 0.042],
    [0.02, -0.08, 0.04],
  ];
  for (const [dx, dz, r] of halves) {
    kit.lathe(
      'food',
      x + dx,
      y + 0.002,
      z + dz,
      [
        [0.001, 0],
        [r, 0],
        [r * 0.96, r * 0.32],
        [r * 0.8, r * 0.58],
        [r * 0.52, r * 0.76],
        [0.001, r * 0.82],
      ],
      { color: '#4a0a1e', finish: 0.55 },
    );
  }
  // Wedges cut from a whole beet, lying on their sides: the dark skin, and cut faces the deep
  // magenta of the flesh.
  const wedge = wedgeGeometry(0.04, 1.2);
  const wedges: [number, number, number][] = [
    [0.0, 0.0, 0.4],
    [0.04, 0.07, 1.9],
    [-0.1, -0.005, 2.6],
  ];
  for (const [dx, dz, ry] of wedges) {
    const place = at(x + dx, y + 0.002, z + dz, { ry, rz: 0.2 });
    kit.add('food', wedge.skin, place, '#4a0a1e', { uv: 'project', finish: 0.55 });
    kit.add('food', wedge.cut, place, '#8e1238', { uv: 'project', finish: 0.6 });
  }
  // A spoon of La Tur, edged with chopped herbs.
  kit.sphere('food', x + 0.085, y + 0.016, z - 0.015, 0.05, {
    sx: 0.8,
    sy: 0.55,
    sz: 1.35,
    ry: -0.3,
    color: '#f6f1e4',
    finish: 0.8,
  });
  for (let i = 0; i < 7; i++)
    kit.sphere('food', x + 0.122 - i * 0.004, y + 0.024, z - 0.075 + i * 0.022, 0.006, {
      color: i % 2 ? '#4f7f2f' : '#6a9a3a',
      finish: 0.9,
    });
  for (const [dx, dz] of [
    [-0.12, 0.09],
    [-0.13, 0.06],
    [0.03, 0.12],
  ] as const)
    kit.sphere('food', x + dx, y + 0.003, z + dz, 0.009, {
      sy: 0.3,
      color: '#6e0b2a',
      finish: 0.15,
    });
}

/** Kabawa, New York: flaky roti and fried bake, with chickpea curry and dips to tear into. */
function rotiAndDips(kit: Kit, x: number, z: number): void {
  const y = plate(kit, x, z + 0.02, 0.2, '#ece0c4');
  // Two roti, each folded in loose, crumpled layers, golden and blistered from the tawa.
  const random = createRandom(17);
  for (const [dx, dz, ry] of [
    [0.02, 0.07, 0.5],
    [0.07, 0.02, 2.5],
  ] as const) {
    for (let layer = 0; layer < 3; layer++) {
      const bread = flatbreadGeometry(0.095 - layer * 0.012, 3 + layer + Math.round(ry * 10));
      kit.add(
        'food',
        bread,
        at(x + dx + (random() - 0.5) * 0.02, y + layer * 0.007, z + dz + (random() - 0.5) * 0.02, {
          ry: ry + (random() - 0.5) * 0.6,
          rx: (random() - 0.5) * 0.1,
          rz: (random() - 0.5) * 0.1,
          sz: 0.85,
        }),
        undefined,
        { finish: 0.85 },
      );
    }
  }
  // Fried bake: puffed golden pillows.
  for (const [dx, dz, ry] of [
    [-0.1, 0.09, 0.2],
    [-0.05, 0.13, -0.3],
  ] as const)
    kit.rounded('food', x + dx, y + 0.023, z + dz, 0.05, 0.042, 0.046, 0.016, '#d89a4c', {
      ry,
      finish: 0.7,
    });
  // The dips in dark stoneware bowls behind the roti, and guava chutney in a cream one.
  const bowl = (bx: number, bz: number, outside: string, inside: string): number => {
    kit.lathe(
      'gloss',
      bx,
      y,
      bz,
      [
        [0.001, 0],
        [0.03, 0],
        [0.045, 0.03],
        [0.047, 0.036],
        [0.042, 0.035],
        [0.03, 0.008],
        [0.001, 0.008],
      ],
      { color: outside, finish: 1.4 },
    );
    kit.cylinder('food', bx, y + 0.026, bz, 0.04, 0.002, { color: inside, finish: 0.25 });
    return y + 0.028;
  };
  const curry = bowl(x, z - 0.09, '#2c2622', '#8a4518');
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    kit.sphere(
      'food',
      x + Math.cos(a) * 0.022,
      curry + 0.003,
      z - 0.09 + Math.sin(a) * 0.022,
      0.008,
      {
        color: '#d09a52',
        finish: 0.6,
      },
    );
  }
  bowl(x - 0.095, z - 0.04, '#2c2622', '#9a5a26');
  const pepper = bowl(x + 0.095, z - 0.05, '#2c2622', '#4a3d1c');
  kit.sphere('food', x + 0.105, pepper + 0.001, z - 0.055, 0.016, {
    sy: 0.4,
    color: '#f2c64a',
    finish: 0.3,
  });
  bowl(x - 0.13, z + 0.03, '#efe7d6', '#b24a1c');
}

/** Theodora, Brooklyn: whipped ricotta piped over toast, with honey, black pepper and rosemary. */
function ricottaToast(kit: Kit, x: number, z: number): void {
  const ry = 0.45;
  // An oval stoneware dish: a terracotta edge around a pale grey glaze. Its long axis follows `ry`.
  kit.lathe(
    'gloss',
    x,
    TOP,
    z,
    [
      [0.001, 0],
      [0.09, 0],
      [0.106, 0.012],
      [0.112, 0.022],
      [0.106, 0.023],
      [0.096, 0.013],
      [0.001, 0.012],
    ],
    { color: '#b0613c', finish: 2.2, ry: ry + Math.PI / 2, depthScale: 1.9 },
  );
  kit.cylinder('gloss', x, TOP + 0.0115, z, 0.095, 0.002, {
    depthScale: 1.9,
    ry: ry + Math.PI / 2,
    color: '#d9d6cf',
    finish: 0.6,
  });
  const y = TOP + 0.014;
  // The toast: a thick slice with a darker crust.
  kit.rounded('food', x, y + 0.012, z, 0.27, 0.024, 0.1, 0.008, '#6e4426', { ry, finish: 0.9 });
  kit.rounded('food', x, y + 0.0235, z, 0.255, 0.002, 0.088, 0.001, '#b07a46', { ry, finish: 1.1 });
  // Ricotta piped across the toast through a star tip, two rows of soft kisses.
  const kiss = pipedKiss(0.017, 0.03);
  for (let i = 0; i < 8; i++) {
    for (const across of [-0.022, 0.022]) {
      const [px, pz] = onAxis(x, z, ry, -0.11 + i * 0.031 + (across > 0 ? 0.015 : 0), across);
      kit.add('food', kiss, at(px, y + 0.023, pz, { ry: i * 0.7 }), '#f8f5ee', {
        uv: 'own',
        finish: 0.85,
      });
    }
  }
  const random = createRandom(31);
  for (let i = 0; i < 18; i++) {
    const [px, pz] = onAxis(x, z, ry, (random() - 0.5) * 0.24, (random() - 0.5) * 0.07);
    kit.sphere('food', px, y + 0.048, pz, 0.002, { color: '#1f1c1a' });
  }
  // Rosemary sprigs, and honey drizzled over and pooling on the dish.
  for (const [along, across, turn] of [
    [-0.06, 0.0, 0.6],
    [0.04, 0.01, -0.5],
  ] as const) {
    const [ax, az] = onAxis(x, z, ry, along - 0.025, across - 0.02);
    const [bx, bz] = onAxis(x, z, ry, along + 0.025, across + 0.02 * Math.sign(turn));
    kit.rod(
      'food',
      new Vector3(ax, y + 0.049, az),
      new Vector3(bx, y + 0.051, bz),
      0.0025,
      5,
      '#3d5a2c',
    );
  }
  for (let i = 0; i < 5; i++) {
    const [ax, az] = onAxis(x, z, ry, -0.1 + i * 0.05, -0.015);
    const [bx, bz] = onAxis(x, z, ry, -0.075 + i * 0.05, 0.02);
    kit.rod(
      'food',
      new Vector3(ax, y + 0.047, az),
      new Vector3(bx, y + 0.048, bz),
      0.0022,
      5,
      '#d08d22',
      0.15,
    );
  }
  const [hx, hz] = onAxis(x, z, ry, 0.08, 0.07);
  kit.cylinder('food', hx, TOP + 0.0135, hz, 0.014, 0.0015, { color: '#c98f2e', finish: 0.12 });
}

/** Kasama, Chicago: a truffle croissant under pearl sugar, in its takeaway box. */
function truffleCroissant(kit: Kit, x: number, z: number): void {
  const kraft = '#b98d5c';
  const half = 0.13;
  const wall = 0.07;
  kit.rounded('matte', x, TOP + 0.002, z, half * 2, 0.004, half * 2, 0.0015, kraft);
  for (const [dx, dz, w, d] of [
    [0, -half, half * 2, 0.004],
    [0, half, half * 2, 0.004],
    [-half, 0, 0.004, half * 2],
    [half, 0, 0.004, half * 2],
  ] as const)
    kit.rounded('matte', x + dx, TOP + wall / 2, z + dz, w, wall, d, 0.0015, kraft);
  // The lid, folded open toward the kitchen.
  kit.boxAt(
    'matte',
    x,
    TOP + wall + 0.94 * half,
    z - half - 0.34 * half,
    half * 2,
    0.004,
    half * 2,
    {
      rx: -1.92,
      color: kraft,
    },
  );
  kit.boxAt('matte', x, TOP + 0.005, z, 0.2, 0.002, 0.2, { ry: 0.25, color: '#efe3c8' });
  // The croissant: a crescent of rolled layers, browned on its crests, pale in its folds.
  const y = TOP + 0.006;
  const bend = 0.08;
  const cz = z - 0.035;
  kit.add('food', croissant, at(x, y + 0.026, cz), undefined, { uv: 'own', finish: 0.5 });
  // Pearl sugar over the top, and a pinch of shaved truffle in the middle.
  const random = createRandom(53);
  for (let i = 0; i < 44; i++) {
    const t = random();
    const a = Math.PI / 2 + (t - 0.5) * 2.3;
    const across = (random() - 0.5) * 1.4;
    // Resting on the dough: as high as the crescent is plump there, lower off its crown.
    const plump = 0.046 * (1 - Math.pow(Math.abs(2 * t - 1), 1.8) * 0.82);
    const r = bend + across * plump;
    const lift = Math.sqrt(Math.max(0, 1 - across * across)) * plump;
    kit.sphere('food', x + Math.cos(a) * r, y + 0.026 + lift + 0.003, cz + Math.sin(a) * r, 0.006, {
      color: '#f8f4ea',
      finish: 0.5,
    });
  }
  for (let i = 0; i < 7; i++)
    kit.rounded(
      'food',
      x + (random() - 0.5) * 0.035,
      y + 0.075,
      cz + bend + (random() - 0.5) * 0.02,
      0.014,
      0.002,
      0.009,
      0.0008,
      '#3e2f20',
      {
        ry: random() * Math.PI,
        finish: 0.7,
      },
    );
}

/** How each dish on the pass is modeled, at its place in the shared layout. */
const DISH_MODELS: Readonly<Record<DishId, (kit: Kit, x: number, z: number) => void>> = {
  'char-siu': charSiu,
  beetroot,
  roti: rotiAndDips,
  'ricotta-toast': ricottaToast,
  'truffle-croissant': truffleCroissant,
};

/** Le passe: plates under glowing heat lamps, and the ticket rail. */
function passe(kit: Kit): void {
  const p = KITCHEN.pass;
  const cz = (p.minZ + p.maxZ) / 2;
  // Gantry: steel posts carrying the lamp housing high enough to see under.
  const housing = HEAT_LAMP_HOUSING_Y;
  for (const x of [p.minX + 0.2, p.maxX - 0.2]) {
    kit.cylinder('steel', x, TOP, cz, 0.028, housing + 0.12 - TOP, { finish: POLISHED });
  }
  kit.rounded('steel', 0, housing + 0.06, cz, p.maxX - p.minX - 0.2, 0.12, 0.36, 0.012);
  // One heat lamp over each plate, on a short stem.
  for (const { x } of PASS_DISHES) {
    kit.add('steel', LAMP_SHADE, at(x, housing - 0.15, cz), undefined, { finish: POLISHED });
    kit.cylinder('steel', x, housing - 0.002, cz, 0.012, 0.004);
    kit.sphere('light', x, housing - 0.13, cz, 0.06, { sy: 0.7, color: BULB });
  }
  // Ticket rail along the kitchen side, with today's orders clipped on.
  const rail = housing - 0.06;
  kit.rod(
    'steel',
    new Vector3(p.minX + 0.3, rail, p.minZ - 0.02),
    new Vector3(p.maxX - 0.3, rail, p.minZ - 0.02),
    0.012,
    undefined,
    undefined,
    POLISHED,
  );
  const random = createRandom(99);
  for (const x of [-3.4, -2.6, -1.7, -0.5, 0.6, 1.5, 2.7, 3.5]) {
    const length = 0.12 + random() * 0.06;
    kit.boxAt('matte', x, rail - length / 2, p.minZ - 0.025, 0.08, length, 0.003, {
      rz: (random() - 0.5) * 0.08,
      color: paint.ticket,
    });
  }

  // Plates waiting to go out: Daniel's favorite dishes, left to right as seen from the dining room.
  for (const dish of PASS_DISHES) DISH_MODELS[dish.id](kit, dish.x, dish.z);
  // The service bell.
  kit.lathe(
    'brass',
    3.6,
    TOP,
    cz,
    [
      [0.001, 0],
      [0.06, 0],
      [0.06, 0.008],
      [0.05, 0.012],
      [0.048, 0.03],
      [0.04, 0.05],
      [0.022, 0.06],
      [0.006, 0.062],
      [0.006, 0.075],
      [0.009, 0.08],
      [0.001, 0.082],
    ],
    { finish: POLISHED },
  );
  // A neat stack of side towels.
  for (let i = 0; i < 5; i++)
    kit.rounded('matte', -3.6, TOP + 0.012 + i * 0.022, cz, 0.28, 0.02, 0.22, 0.008, '#f4f1ea');
}

/** Where a station's centerpiece stands, from the shared layout. */
function stationAt(id: StationId): { x: number; z: number } {
  const station = STATIONS.find((s) => s.id === id)!;
  return { x: station.x, z: station.z };
}

/** Garde manger: a cheese under a glass cloche, a pâté en croûte, and oysters on ice. */
function gardeManger(kit: Kit): void {
  const { x: cx, z: cz } = stationAt('garde-manger');
  kit.lathe(
    'wood',
    cx,
    TOP,
    cz,
    [
      [0.001, 0],
      [0.215, 0],
      [0.22, 0.006],
      [0.22, 0.026],
      [0.214, 0.03],
      [0.001, 0.03],
    ],
    { color: paint.wood },
  );
  // A wheel of comté, a wedge cut from it, rind and paste.
  kit.lathe(
    'food',
    cx - 0.04,
    TOP + 0.03,
    cz - 0.01,
    [
      [0.001, 0],
      [0.102, 0],
      [0.11, 0.008],
      [0.11, 0.062],
      [0.102, 0.07],
      [0.001, 0.07],
    ],
    { color: '#c99a52', finish: 1.1 },
  );
  kit.cylinder('food', cx - 0.04, TOP + 0.0995, cz - 0.01, 0.099, 0.001, {
    color: '#efd38f',
    finish: 0.9,
  });
  const wedge = new Shape();
  wedge.moveTo(0, 0);
  wedge.absarc(0, 0, 0.075, 0, 0.7, false);
  wedge.lineTo(0, 0);
  const wedgeGeometry = new ExtrudeGeometry(wedge, {
    depth: 0.06,
    bevelEnabled: true,
    bevelSize: 0.003,
    bevelThickness: 0.003,
    bevelSegments: 2,
    curveSegments: 12,
  });
  kit.add(
    'food',
    wedgeGeometry,
    at(cx + 0.035, TOP + 0.033, cz + 0.03, { rx: -Math.PI / 2, ry: -0.2 }),
    '#f0d897',
    { finish: 0.9 },
  );
  // The cloche: a glass dome with a rolled foot and a steel knob.
  const dome: [number, number][] = [[0.1905, 0]];
  for (let i = 1; i <= 12; i++) {
    const h = 0.2185 * Math.sin((i / 12) * (Math.PI / 2));
    dome.push([Math.max(0.001, 0.19 * Math.sqrt(1 - (h / 0.2185) ** 2)), h]);
  }
  kit.lathe('glass', cx, TOP + 0.03, cz, dome);
  kit.sphere('steel', cx, TOP + 0.255, cz, 0.022, { finish: POLISHED });
  kit.add(
    'steel',
    kit.torus(0.19, 0.006),
    at(cx, TOP + 0.032, cz, { rx: Math.PI / 2 }),
    undefined,
    {
      uv: 'own',
      finish: POLISHED,
    },
  );

  // Pâté en croûte on a board along the island, two slices fanned out: a crimped golden crust round
  // a pink farce, under a layer of clear jelly.
  const px = cx - 1.1;
  kit.rounded('wood', px, TOP + 0.0125, cz, 0.5, 0.025, 0.24, 0.006, paint.wood);
  kit.rounded('food', px - 0.05, TOP + 0.075, cz, 0.28, 0.1, 0.12, 0.018, '#c98a3e', {
    finish: 0.6,
  });
  for (let i = 0; i < 9; i++) {
    kit.sphere('food', px - 0.17 + i * 0.03, TOP + 0.125, cz, 0.012, {
      sy: 0.6,
      sz: 4.4,
      color: '#b97830',
      finish: 0.55,
    });
  }
  for (let i = 0; i < 2; i++) {
    const x = px + 0.14 + i * 0.05;
    kit.rounded('food', x, TOP + 0.03 + i * 0.012, cz, 0.1, 0.012, 0.12, 0.004, '#c98a3e', {
      rz: -0.15,
      ry: 0.2,
      finish: 0.6,
    });
    kit.rounded('food', x, TOP + 0.037 + i * 0.012, cz, 0.08, 0.004, 0.096, 0.002, '#c87c70', {
      rz: -0.15,
      ry: 0.2,
      finish: 0.9,
    });
    kit.rounded(
      'food',
      x - 0.03,
      TOP + 0.0375 + i * 0.012,
      cz,
      0.012,
      0.0045,
      0.098,
      0.002,
      '#e5c87a',
      { rz: -0.15, ry: 0.2, finish: 0.2 },
    );
  }

  // A platter of oysters on crushed ice, a lemon in the middle.
  const ox = cx + 1.1;
  kit.lathe(
    'steel',
    ox,
    TOP,
    cz,
    [
      [0.001, 0],
      [0.255, 0],
      [0.26, 0.006],
      [0.262, 0.028],
      [0.256, 0.034],
      [0.245, 0.032],
      [0.23, 0.012],
      [0.001, 0.012],
    ],
    { finish: POLISHED },
  );
  const random = createRandom(41);
  for (let i = 0; i < 46; i++) {
    const a = random() * Math.PI * 2;
    const r = Math.sqrt(random()) * 0.215;
    kit.sphere(
      'food',
      ox + Math.cos(a) * r,
      TOP + 0.022,
      cz + Math.sin(a) * r,
      0.016 + random() * 0.01,
      {
        sy: 0.5,
        color: '#e6eef2',
        finish: 0.25,
      },
    );
  }
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = i % 3 === 0 ? 0.08 : 0.17;
    const sx = ox + Math.cos(a) * r;
    const sz = cz + Math.sin(a) * r;
    // The shell, rough and grey, and the oyster in it, glistening.
    kit.sphere('food', sx, TOP + 0.042, sz, 0.045, {
      sy: 0.3,
      sz: 0.7,
      ry: a,
      color: '#8f8a84',
      finish: 1.3,
    });
    kit.sphere('food', sx, TOP + 0.054, sz, 0.03, {
      sy: 0.18,
      sz: 0.6,
      ry: a,
      color: '#c9c1ae',
      finish: 0.15,
    });
  }
  kit.sphere('food', ox, TOP + 0.05, cz, 0.03, { color: '#f2cf3e', finish: 0.6 });
}

/** Pâtisserie: a croquembouche, macarons, and a stand mixer, with a marble slab for the pastry. */
function patisserie(kit: Kit): void {
  const { x: cx, z: cz } = stationAt('patisserie');
  // A marble slab set on the charcoal top: cool, for working butter into dough.
  kit.rounded('stone', cx + 0.05, TOP + 0.01, cz, 3.3, 0.02, 0.8, 0.005, paint.marble, {
    finish: 0.4,
  });
  const top = TOP + 0.02;
  // The croquembouche: a cone of caramel-glazed choux on a silver base, wound with spun sugar.
  kit.lathe(
    'steel',
    cx,
    top,
    cz,
    [
      [0.001, 0],
      [0.2, 0],
      [0.22, 0.01],
      [0.215, 0.02],
      [0.001, 0.02],
    ],
    { finish: POLISHED },
  );
  const random = createRandom(111);
  const height = 0.62;
  const rows = 13;
  for (let row = 0; row < rows; row++) {
    const t = row / (rows - 1);
    const ringRadius = 0.16 * (1 - t) + 0.012;
    const y = top + 0.05 + t * height;
    const count = Math.max(1, Math.round((Math.PI * 2 * ringRadius) / 0.055));
    const offset = random() * Math.PI;
    for (let i = 0; i < count; i++) {
      const a = offset + (i / count) * Math.PI * 2;
      kit.sphere('food', cx + Math.cos(a) * ringRadius, y, cz + Math.sin(a) * ringRadius, 0.032, {
        sy: 0.92,
        color: random() < 0.5 ? '#c98a40' : '#b87632',
        finish: 0.35,
      });
    }
  }
  for (let i = 0; i < 60; i++) {
    const point = (t: number): Vector3 => {
      const a = t * Math.PI * 7;
      const r = 0.2 * (1 - t) + 0.03;
      return new Vector3(cx + Math.cos(a) * r, top + 0.06 + t * height, cz + Math.sin(a) * r);
    };
    kit.rod('food', point(i / 60), point((i + 1) / 60), 0.0018, 5, '#e2a33a', 0.12);
  }

  // Macarons in pastel rows on a tray: two domed shells and their filling.
  const tx = cx - 1.1;
  const tz = cz + 0.05;
  kit.rounded('steel', tx, top + 0.006, tz, 0.5, 0.012, 0.34, 0.004, undefined, {
    finish: POLISHED,
  });
  const colors = ['#f1a4c2', '#b6dcae', '#c7b4e6', '#f3dd88'];
  const shell: [number, number][] = [
    [0.001, 0],
    [0.03, 0],
    [0.032, 0.004],
    [0.03, 0.009],
    [0.02, 0.014],
    [0.001, 0.016],
  ];
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 5; i++) {
      const x = tx - 0.19 + i * 0.095;
      const z = tz - 0.12 + row * 0.08;
      const color = colors[row]!;
      kit.lathe(
        'food',
        x,
        top + 0.012,
        z,
        shell.map(([r, h]) => [r, 0.016 - h] as [number, number]),
        { color, finish: 0.7, segments: 20 },
      );
      kit.cylinder('food', x, top + 0.028, z, 0.027, 0.006, {
        color: '#fbf3e4',
        finish: 0.6,
        segments: 20,
      });
      kit.lathe('food', x, top + 0.034, z, shell, { color, finish: 0.7, segments: 20 });
    }
  }

  // A cream stand mixer: its base, column and head, the bowl and the beater.
  const mx = cx + 1.0;
  const mz = cz - 0.1;
  kit.rounded('gloss', mx, top + 0.03, mz, 0.34, 0.06, 0.2, 0.028, paint.cream, { finish: 0.9 });
  kit.rounded('gloss', mx + 0.12, top + 0.2, mz, 0.11, 0.32, 0.13, 0.045, paint.cream, {
    finish: 0.9,
  });
  kit.rounded('gloss', mx - 0.02, top + 0.4, mz, 0.4, 0.13, 0.15, 0.06, paint.cream, {
    finish: 0.9,
  });
  kit.lathe(
    'brass',
    mx - 0.21,
    top + 0.4,
    mz,
    [
      [0.001, 0],
      [0.032, 0],
      [0.034, 0.012],
      [0.001, 0.013],
    ],
    { rz: Math.PI / 2 },
  );
  vessel(kit, 'steel', mx - 0.06, top + 0.06, mz, 0.085, 0.15, { flare: 1.25, finish: POLISHED });
  kit.rod(
    'steel',
    new Vector3(mx - 0.06, top + 0.34, mz),
    new Vector3(mx - 0.06, top + 0.14, mz),
    0.008,
    undefined,
    undefined,
    POLISHED,
  );
  kit.lathe(
    'food',
    mx - 0.06,
    top + 0.07,
    mz,
    [
      [0.001, 0.12],
      [0.08, 0.12],
      [0.07, 0.13],
      [0.035, 0.145],
      [0.001, 0.15],
    ],
    { color: '#f6ead2', finish: 0.8 },
  );

  // A rolling pin in a dusting of flour, which stays on the marble.
  const rx = cx + 1.55;
  kit.cylinder('matte', rx, top + 0.0005, cz + 0.15, 0.15, 0.001, { color: '#fbfaf6' });
  kit.lathe(
    'wood',
    rx,
    top + 0.03,
    cz - 0.08,
    [
      [0.001, 0],
      [0.012, 0],
      [0.014, 0.06],
      [0.03, 0.075],
      [0.03, 0.385],
      [0.014, 0.4],
      [0.012, 0.46],
      [0.001, 0.46],
    ],
    { color: paint.woodLight, rx: Math.PI / 2 },
  );
}

/** Plonge: the pre-rinse spray over the dish pit's sink, and clean plates and glasses. */
function plonge(kit: Kit): void {
  const { x: cx } = stationAt('plonge');
  // The counter is against the south wall; the room is to the north (-Z).
  const back = KITCHEN.plonge.maxZ - 0.1;
  const out = -1;
  // The pre-rinse unit: a tall riser, an arched head, a spring-hung spray, and a swing faucet.
  kit.cylinder('steel', cx, TOP, back, 0.025, 1.1, { finish: POLISHED });
  kit.add(
    'steel',
    kit.torus(0.16, 0.018, Math.PI),
    at(cx, TOP + 1.1, back + out * 0.16, { ry: Math.PI / 2 }),
    undefined,
    {
      uv: 'own',
      finish: POLISHED,
    },
  );
  const hose = back + out * 0.32;
  kit.cylinder('steel', cx, TOP + 0.45, hose, 0.016, 0.65, { finish: POLISHED });
  // The spring round the hose: a helix of wire.
  let last = new Vector3(cx + 0.03, TOP + 0.55, hose);
  for (let i = 1; i <= 14 * 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    const next = new Vector3(
      cx + Math.cos(a) * 0.03,
      TOP + 0.55 + (i / (14 * 12)) * 0.49,
      hose + Math.sin(a) * 0.03,
    );
    kit.rod('steel', last, next, 0.0035, 5, undefined, POLISHED);
    last = next;
  }
  kit.lathe(
    'gloss',
    cx,
    TOP + 0.27,
    hose,
    [
      [0.001, 0],
      [0.03, 0],
      [0.04, 0.02],
      [0.036, 0.15],
      [0.02, 0.17],
      [0.001, 0.17],
    ],
    { color: '#1e2224', finish: 1.6 },
  );
  kit.cylinder('steel', cx, TOP + 0.26, hose, 0.045, 0.02, { finish: POLISHED });
  kit.rod(
    'steel',
    new Vector3(cx, TOP + 0.65, back),
    new Vector3(cx, TOP + 0.65, back + out * 0.3),
    0.015,
    undefined,
    undefined,
    POLISHED,
  );

  // Clean plates stacked between the sinks, and a rack of glasses over the other one.
  for (const [x, count] of [
    [6.05, 16],
    [6.4, 11],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const profile =
        i === count - 1
          ? plateProfile(0.15, 0.014)
          : ([
              [0.001, 0],
              [0.08, 0],
              [0.138, 0.0105],
              [0.15, 0.014],
              [0.001, 0.014],
            ] as [number, number][]);
      kit.lathe('gloss', x, TOP + 0.02 + i * 0.018, 6.18, profile, {
        color: paint.porcelain,
        finish: 0.5,
        segments: 28,
      });
    }
  }
  kit.rounded('steel', 5.3, TOP + 0.025, 6.17, 0.9, 0.01, 0.38, 0.003, undefined, { finish: 1.3 });
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 3; k++) {
      kit.lathe('glass', 5.0 + i * 0.3, TOP + 0.03, 6.06 + k * 0.12, [
        [0.001, 0],
        [0.036, 0],
        [0.04, 0.012],
        [0.042, 0.14],
        [0.039, 0.14],
        [0.036, 0.016],
        [0.001, 0.016],
      ]);
    }
  }
  kit.steamFrom(cx, TOP + 0.05, 6.15, 0.7);
}

/** Every station centerpiece, plus the shared middle of the piano. */
export function buildStationProps(kit: Kit): void {
  pianoCenter(kit);
  saucier(kit);
  poissonnier(kit);
  rotisseur(kit);
  entremetier(kit);
  passe(kit);
  gardeManger(kit);
  patisserie(kit);
  plonge(kit);
}
