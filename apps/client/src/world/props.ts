import { Color, LatheGeometry, TorusGeometry, Vector2, Vector3 } from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { COUNTER_HEIGHT, KITCHEN, STATIONS, createRandom, type StationId } from '@world/shared';
import { at } from './builder.ts';
import { paint, type Kit } from './kit.ts';

/**
 * The centerpiece of each station: what a cook at that station would have in front of them.
 * Positions match the station centers in the shared layout.
 */

const TOP = COUNTER_HEIGHT;
/** Height of a cooking zone's cast iron plate. */
const ZONE = TOP + 0.01;
/** Heat lamp bulbs glow brighter than any paint, so their color goes past 1. */
const BULB = new Color(paint.bulb).multiplyScalar(1.4);
/** A heat lamp shade with a thin wall, so it reads from above and below. */
const LAMP_SHADE = new LatheGeometry(
  [
    [0.001, 0.15],
    [0.05, 0.15],
    [0.14, 0.0],
    [0.132, 0.0],
    [0.045, 0.14],
    [0.001, 0.14],
  ].map(([x, y]) => new Vector2(x, y)),
  10,
);

/** An open gas burner: a crown, a cast iron grate, and flames. Returns where a pan sits. */
function burner(kit: Kit, x: number, z: number, size = 1): number {
  kit.cylinder('iron', x, ZONE, z, 0.075 * size, 0.025, { segments: 16 });
  kit.add(
    'iron',
    new TorusGeometry(0.17 * size, 0.012, 3, 14),
    at(x, ZONE + 0.05, z, { rx: Math.PI / 2 }),
  );
  for (const ry of [0, Math.PI / 2])
    kit.boxAt('iron', x, ZONE + 0.05, z, 0.4 * size, 0.022, 0.022, { ry });
  kit.burner(x, ZONE + 0.022, z, 0.07 * size);
  return ZONE + 0.062;
}

/** A copper saucepan with a long iron handle pointing toward `handleDir` (radians, 0 = +X). */
function saucepan(
  kit: Kit,
  x: number,
  y: number,
  z: number,
  radius: number,
  height: number,
  handleDir: number,
  contents: string,
): void {
  kit.cylinder('copper', x, y, z, radius, height, { segments: 32 });
  kit.cylinder('gloss', x, y + height - 0.015, z, radius - 0.008, 0.016, {
    segments: 32,
    color: contents,
  });
  kit.add(
    'brass',
    new TorusGeometry(radius, 0.006, 3, 14),
    at(x, y + height, z, { rx: Math.PI / 2 }),
  );
  const length = 0.24 + radius;
  const hx = x + Math.cos(handleDir) * (radius + length / 2);
  const hz = z - Math.sin(handleDir) * (radius + length / 2);
  kit.boxAt('iron', hx, y + height * 0.85, hz, length, 0.018, 0.03, { ry: handleDir, rz: 0.12 });
}

/** Saucier: copper saucepans on the French top, the sauce for every plate. */
function saucier(kit: Kit): void {
  const cx = -2.6;
  const cz = -0.75;
  // French top: concentric cast iron rings over a hidden flame.
  for (const r of [0.12, 0.24, 0.36]) {
    kit.add(
      'iron',
      new TorusGeometry(r, 0.007, 3, 14),
      at(cx, ZONE + 0.002, cz, { rx: Math.PI / 2 }),
    );
  }
  kit.cylinder('iron', cx, ZONE, cz, 0.05, 0.01, { segments: 16 });
  // Handles point north, toward the cook.
  saucepan(kit, cx - 0.36, ZONE, cz + 0.05, 0.13, 0.12, Math.PI / 2 + 0.3, '#7a3416');
  saucepan(kit, cx + 0.05, ZONE, cz + 0.12, 0.17, 0.15, Math.PI / 2, '#a8682a');
  saucepan(kit, cx + 0.45, ZONE, cz - 0.05, 0.11, 0.1, Math.PI / 2 - 0.3, '#e9d9a6');
  kit.steamFrom(cx + 0.05, ZONE + 0.17, cz + 0.12, 1.1);
  // A whisk resting in the biggest pan, and a ladle in a bain-marie.
  kit.rod(
    'steel',
    new Vector3(cx + 0.05, ZONE + 0.13, cz + 0.12),
    new Vector3(cx + 0.22, ZONE + 0.42, cz - 0.02),
    0.006,
  );
  kit.sphere('steel', cx + 0.03, ZONE + 0.12, cz + 0.13, 0.04, { sy: 1.6 });
  kit.cylinder('steel', cx - 0.75, ZONE, cz - 0.15, 0.09, 0.16, { segments: 20 });
  kit.rod(
    'steel',
    new Vector3(cx - 0.75, ZONE + 0.1, cz - 0.15),
    new Vector3(cx - 0.8, ZONE + 0.36, cz - 0.3),
    0.007,
  );
}

/** Poissonnier: a whole fish on a steel tray, a copper fish kettle on the flame. */
function poissonnier(kit: Kit): void {
  const cx = 2.6;
  const cz = -0.75;
  kit.box('steel', cx - 0.5, cx + 0.2, ZONE, ZONE + 0.02, cz - 0.15, cz + 0.2);
  const fy = ZONE + 0.06;
  kit.sphere('gloss', cx - 0.15, fy, cz + 0.03, 0.06, {
    sx: 4.6,
    sy: 0.8,
    sz: 1.4,
    color: '#a9b9c2',
  });
  kit.sphere('gloss', cx - 0.15, fy + 0.015, cz + 0.03, 0.055, {
    sx: 4.2,
    sy: 0.6,
    sz: 0.9,
    color: '#5c6f7c',
  });
  kit.sphere('gloss', cx + 0.13, fy, cz + 0.03, 0.05, {
    sx: 0.4,
    sy: 1.0,
    sz: 1.5,
    color: '#8fa0aa',
  });
  kit.sphere('matte', cx - 0.39, fy + 0.012, cz + 0.07, 0.009, { color: '#111111' });
  for (const [dx, dz] of [
    [-0.42, -0.08],
    [-0.3, -0.1],
  ] as const) {
    kit.sphere('gloss', cx + dx, ZONE + 0.035, cz + dz, 0.035, { sy: 0.7, color: '#f2cf3e' });
  }
  for (let i = 0; i < 5; i++)
    kit.sphere('matte', cx + 0.05 + i * 0.03, ZONE + 0.035, cz - 0.08 + (i % 2) * 0.02, 0.018, {
      color: '#4f8a2e',
    });
  // The kettle: a long oval pan, lid set ajar.
  const kx = cx + 0.55;
  const ky = burner(kit, kx, cz + 0.1);
  kit.cylinder('copper', kx, ky, cz + 0.1, 0.32, 0.13, { segments: 36, depthScale: 0.42 });
  kit.cylinder('copper', kx - 0.04, ky + 0.13, cz + 0.1, 0.31, 0.02, {
    segments: 36,
    depthScale: 0.4,
    taper: 0.9,
    rz: 0.06,
  });
  for (const dx of [-0.34, 0.34]) kit.boxAt('brass', kx + dx, ky + 0.1, cz + 0.1, 0.06, 0.02, 0.05);
  kit.steamFrom(kx + 0.22, ky + 0.15, cz + 0.1, 0.8);
}

/** Rôtisseur: a golden roast chicken resting in a copper roasting pan. */
function rotisseur(kit: Kit): void {
  const cx = 2.6;
  const cz = 0.75;
  // Plancha for searing, beside the roast.
  kit.box('steel', cx + 0.35, cx + 0.95, ZONE, ZONE + 0.03, cz - 0.4, cz + 0.4);
  kit.box('iron', cx + 0.38, cx + 0.92, ZONE + 0.03, ZONE + 0.032, cz - 0.37, cz + 0.37);
  for (let i = 0; i < 3; i++) {
    kit.boxAt(
      'gloss',
      cx + 0.55 + (i % 2) * 0.18,
      ZONE + 0.045,
      cz - 0.2 + i * 0.18,
      0.12,
      0.03,
      0.08,
      { ry: 0.3 * i, color: '#7a3a24' },
    );
  }
  // Roasting pan.
  kit.box('copper', cx - 0.32, cx + 0.22, ZONE, ZONE + 0.02, cz - 0.2, cz + 0.2);
  for (const [x0, x1, z0, z1] of [
    [cx - 0.32, cx + 0.22, cz - 0.2, cz - 0.18],
    [cx - 0.32, cx + 0.22, cz + 0.18, cz + 0.2],
    [cx - 0.32, cx - 0.3, cz - 0.2, cz + 0.2],
    [cx + 0.2, cx + 0.22, cz - 0.2, cz + 0.2],
  ] as const) {
    kit.box('copper', x0, x1, ZONE, ZONE + 0.08, z0, z1);
  }
  for (const dx of [-0.38, 0.28]) kit.boxAt('brass', cx + dx, ZONE + 0.06, cz, 0.06, 0.018, 0.12);
  // The chicken: body, breast, drumsticks and wings, browned.
  const y = ZONE + 0.1;
  const x = cx - 0.05;
  kit.sphere('gloss', x, y, cz, 0.12, { sx: 1.35, sy: 0.85, sz: 1.05, color: '#c27a35' });
  kit.sphere('gloss', x - 0.06, y + 0.045, cz, 0.09, {
    sx: 1.1,
    sy: 0.75,
    sz: 1.2,
    color: '#d38d43',
  });
  for (const side of [-1, 1]) {
    kit.sphere('gloss', x + 0.11, y - 0.01, cz + side * 0.1, 0.05, {
      sx: 1.7,
      sy: 0.9,
      sz: 0.9,
      ry: side * -0.5,
      color: '#b56c2c',
    });
    kit.sphere('gloss', x + 0.19, y - 0.005, cz + side * 0.13, 0.018, { color: '#f1e3c8' });
    kit.sphere('gloss', x - 0.03, y + 0.01, cz + side * 0.13, 0.04, {
      sx: 1.4,
      sy: 0.6,
      sz: 0.8,
      ry: side * 0.4,
      color: '#b56c2c',
    });
  }
  // Garlic and thyme around it.
  for (let i = 0; i < 4; i++) {
    kit.sphere('matte', cx - 0.25 + i * 0.13, ZONE + 0.05, cz + (i % 2 ? 0.14 : -0.14), 0.025, {
      color: '#efe6d2',
    });
  }
  for (let i = 0; i < 6; i++) {
    kit.rod(
      'matte',
      new Vector3(cx - 0.27 + i * 0.07, ZONE + 0.04, cz - 0.15),
      new Vector3(cx - 0.22 + i * 0.07, ZONE + 0.04, cz - 0.05),
      0.005,
    );
  }
}

/** Entremetier: vegetables, soups and eggs. A stockpot on the boil and a board of carrots. */
function entremetier(kit: Kit): void {
  const cx = -2.6;
  const cz = 0.75;
  const potX = cx - 0.45;
  const py = burner(kit, potX, cz, 1.1);
  kit.cylinder('steel', potX, py, cz, 0.21, 0.36, { segments: 32 });
  kit.cylinder('gloss', potX, py + 0.34, cz, 0.2, 0.012, { segments: 32, color: '#d8a24a' });
  kit.add(
    'steel',
    new TorusGeometry(0.21, 0.01, 3, 14),
    at(potX, py + 0.36, cz, { rx: Math.PI / 2 }),
  );
  for (const side of [-1, 1])
    kit.boxAt('steel', potX + side * 0.24, py + 0.3, cz, 0.06, 0.03, 0.08);
  kit.steamFrom(potX, py + 0.4, cz, 1.2);

  // Cutting board with carrots, leeks and a chef's knife.
  const bx = cx + 0.25;
  kit.boxAt('matte', bx, ZONE + 0.015, cz + 0.02, 0.5, 0.03, 0.32, { color: paint.woodLight });
  const by = ZONE + 0.03;
  for (let i = 0; i < 3; i++) {
    kit.cylinder('matte', bx - 0.17, by + 0.022, cz - 0.07 + i * 0.06, 0.02, 0.22, {
      taper: 0.25,
      rz: -Math.PI / 2,
      ry: 0.15 * i,
      color: '#e5742a',
    });
  }
  for (let i = 0; i < 6; i++) {
    kit.cylinder('matte', bx + 0.06 + i * 0.012, by + 0.004, cz + 0.06 + i * 0.012, 0.006, 0.006, {
      color: '#e5742a',
    });
  }
  kit.cylinder('matte', bx + 0.18, by + 0.025, cz - 0.08, 0.025, 0.2, {
    rz: Math.PI / 2,
    ry: 0.4,
    color: '#7fa64a',
  });
  kit.boxAt('steel', bx + 0.08, by + 0.004, cz + 0.13, 0.22, 0.004, 0.04, { ry: -0.15 });
  kit.boxAt('matte', bx - 0.07, by + 0.01, cz + 0.155, 0.11, 0.02, 0.025, {
    ry: -0.15,
    color: paint.rubber,
  });
  // A bowl of eggs.
  kit.cylinder('gloss', cx + 0.75, ZONE, cz - 0.1, 0.12, 0.07, {
    taper: 1.3,
    segments: 24,
    color: paint.porcelain,
  });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2;
    kit.sphere(
      'gloss',
      cx + 0.75 + Math.cos(a) * 0.05,
      ZONE + 0.08,
      cz - 0.1 + Math.sin(a) * 0.05,
      0.03,
      { sy: 1.25, color: '#f0dcc0' },
    );
  }
}

/** The heart of the piano: a big stockpot and a copper rondeau, both on the boil. */
function pianoCenter(kit: Kit): void {
  const sy = burner(kit, -0.55, 0, 1.25);
  kit.cylinder('steel', -0.55, sy, 0, 0.27, 0.46, { segments: 36 });
  kit.add(
    'steel',
    new TorusGeometry(0.27, 0.012, 3, 14),
    at(-0.55, sy + 0.46, 0, { rx: Math.PI / 2 }),
  );
  kit.cylinder('gloss', -0.55, sy + 0.44, 0, 0.26, 0.012, { segments: 36, color: '#c99a4e' });
  kit.steamFrom(-0.55, sy + 0.5, 0, 1.4);
  const ry = burner(kit, 0.6, 0, 1.25);
  kit.cylinder('copper', 0.6, ry, 0, 0.3, 0.15, { segments: 36 });
  kit.cylinder('gloss', 0.6, ry + 0.13, 0, 0.29, 0.012, { segments: 36, color: '#8a3b1c' });
  for (const side of [-1, 1]) kit.boxAt('brass', 0.6 + side * 0.34, ry + 0.11, 0, 0.08, 0.02, 0.06);
  kit.steamFrom(0.6, ry + 0.18, 0, 0.9);

  // Salt, pepper and side towels on the steel at the ends of the piano.
  kit.boxAt('matte', -4.3, TOP + 0.06, -0.4, 0.18, 0.12, 0.14, { color: paint.wood });
  kit.cylinder('matte', -4.3, TOP, 0.2, 0.03, 0.22, { color: '#3b2416' });
  for (let i = 0; i < 4; i++)
    kit.boxAt('matte', -4.3, TOP + 0.012 + i * 0.022, 0.75, 0.3, 0.02, 0.24, { color: '#f4f1ea' });
  kit.cylinder('steel', 4.3, TOP, 0.3, 0.13, 0.08, { taper: 1.4, segments: 24 });
  for (let i = 0; i < 5; i++) {
    kit.rod(
      'steel',
      new Vector3(4.3, TOP + 0.03, 0.3),
      new Vector3(4.24 + i * 0.03, TOP + 0.2, 0.25 + i * 0.02),
      0.004,
    );
  }
}

/** A plain round plate with a raised rim. Returns the height its food sits on. */
function plate(kit: Kit, x: number, z: number, radius: number, color: string, rim = color): number {
  kit.cylinder('gloss', x, TOP, z, radius, 0.016, { segments: 12, color });
  kit.add(
    'gloss',
    new TorusGeometry(radius - 0.012, 0.008, 3, 14),
    at(x, TOP + 0.016, z, { rx: Math.PI / 2 }),
    rim,
  );
  return TOP + 0.016;
}

/** A point `along` the axis at angle `ry` from (x, z), and `across` it. */
function onAxis(x: number, z: number, ry: number, along: number, across = 0): [number, number] {
  return [
    x + Math.cos(ry) * along + Math.sin(ry) * across,
    z - Math.sin(ry) * along + Math.cos(ry) * across,
  ];
}

/** Kamcentre Roast Goose, Hong Kong: char siu, lacquered and charred at the edges. */
function charSiu(kit: Kit, x: number, z: number): void {
  const y = plate(kit, x, z, 0.19, paint.porcelain);
  kit.cylinder('gloss', x + 0.03, y, z + 0.03, 0.08, 0.002, { color: '#b58450' });
  const random = createRandom(7);
  const chunks: [number, number, number][] = [
    [-0.09, -0.05, 0],
    [-0.02, -0.08, 0],
    [0.07, -0.06, 0],
    [-0.07, 0.04, 0],
    [0.01, 0.02, 0],
    [0.09, 0.04, 0],
    [-0.01, 0.1, 0],
    [-0.03, -0.02, 1],
    [0.05, 0.0, 1],
  ];
  for (const [dx, dz, layer] of chunks) {
    const cx = x + dx;
    const cz = z + dz;
    const ry = random() * Math.PI;
    const tilt = (random() - 0.5) * 0.5;
    const cy = y + 0.022 + layer * 0.034;
    // Sliced so the pink-brown cut face shows on top, ringed by lacquer, one edge charred black.
    kit.boxAt('gloss', cx, cy, cz, 0.07, 0.04, 0.045, { ry, rz: tilt, color: '#4f1d16' });
    kit.boxAt('matte', cx, cy + 0.0205, cz, 0.06, 0.002, 0.036, { ry, rz: tilt, color: '#a8705f' });
    const [ex, ez] = onAxis(cx, cz, ry, 0, -0.019);
    kit.boxAt('gloss', ex, cy + 0.018, ez, 0.072, 0.01, 0.01, { ry, rz: tilt, color: '#1f0c08' });
  }
}

/** The Four Horsemen, Brooklyn: glazed beetroot with La Tur, in a pool of its own juices. */
function beetroot(kit: Kit, x: number, z: number): void {
  const y = plate(kit, x, z, 0.19, paint.porcelain);
  kit.cylinder('gloss', x, y, z, 0.13, 0.003, { segments: 12, color: '#d6c08e' });
  // Glazed halves, dark and shiny, and wedges showing their magenta flesh.
  const halves: [number, number, number][] = [
    [-0.07, 0.05, 0.05],
    [-0.06, -0.06, 0.042],
    [0.02, -0.08, 0.04],
  ];
  for (const [dx, dz, r] of halves)
    kit.sphere('gloss', x + dx, y + 0.004, z + dz, r, { sy: 0.55, color: '#3d0a17' });
  const wedges: [number, number, number][] = [
    [0.0, 0.0, 0.4],
    [0.04, 0.07, 1.9],
    [-0.1, -0.005, 2.6],
  ];
  for (const [dx, dz, ry] of wedges)
    kit.cylinder('gloss', x + dx, y + 0.003, z + dz, 0.042, 0.04, {
      segments: 3,
      ry,
      color: '#7c1232',
    });
  // A spoon of La Tur, edged with chopped herbs.
  kit.sphere('matte', x + 0.085, y + 0.016, z - 0.015, 0.05, {
    sx: 0.8,
    sy: 0.6,
    sz: 1.35,
    ry: -0.3,
    color: '#f6f2e8',
  });
  for (let i = 0; i < 5; i++)
    kit.sphere('matte', x + 0.124 - i * 0.004, y + 0.024, z - 0.07 + i * 0.026, 0.007, {
      color: '#5f8a3a',
    });
  for (const [dx, dz] of [
    [-0.12, 0.09],
    [-0.13, 0.06],
    [0.03, 0.12],
  ] as const)
    kit.cylinder('gloss', x + dx, y + 0.003, z + dz, 0.012, 0.002, { color: '#8e1b3a' });
}

/** Kabawa, New York: flaky roti and fried bake, with chickpea curry and dips to tear into. */
function rotiAndDips(kit: Kit, x: number, z: number): void {
  const y = plate(kit, x, z + 0.02, 0.2, '#ece0c4', '#d8c7a2');
  // Two folded roti, each a few loose, crumpled layers, golden and blistered.
  const random = createRandom(17);
  for (const [dx, dz, ry] of [
    [0.02, 0.07, 0.5],
    [0.07, 0.02, 2.5],
  ] as const) {
    for (let layer = 0; layer < 3; layer++) {
      const lx = x + dx + (random() - 0.5) * 0.02;
      const lz = z + dz + (random() - 0.5) * 0.02;
      const ly = y + layer * 0.011;
      kit.cylinder('matte', lx, ly, lz, 0.1 - layer * 0.01, 0.008, {
        segments: 4 + layer,
        ry: ry + (random() - 0.5) * 0.6,
        rx: (random() - 0.5) * 0.2,
        rz: (random() - 0.5) * 0.2,
        color: ['#8a4c1e', '#9a5a24', '#a8682a'][layer],
      });
      // Browned blisters on each layer.
      for (let k = 0; k < 2; k++)
        kit.cylinder(
          'matte',
          lx + (random() - 0.5) * 0.06,
          ly + 0.0085,
          lz + (random() - 0.5) * 0.06,
          0.012,
          0.002,
          {
            color: '#6a3412',
          },
        );
    }
  }
  // Fried bake, two golden cubes.
  for (const [dx, dz, ry] of [
    [-0.1, 0.09, 0.2],
    [-0.05, 0.13, -0.3],
  ] as const)
    kit.boxAt('matte', x + dx, y + 0.022, z + dz, 0.045, 0.045, 0.045, { ry, color: '#dda255' });
  // The dips, in dark stoneware bowls behind the roti, and guava chutney in a cream one.
  const bowl = (bx: number, bz: number, outside: string, inside: string): number => {
    kit.cylinder('gloss', bx, y, bz, 0.04, 0.035, { taper: 1.3, color: outside });
    kit.cylinder('gloss', bx, y + 0.026, bz, 0.046, 0.004, { color: inside });
    return y + 0.03;
  };
  const curry = bowl(x, z - 0.09, '#2c2622', '#7a3e18');
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    kit.sphere(
      'matte',
      x + Math.cos(a) * 0.02,
      curry + 0.004,
      z - 0.09 + Math.sin(a) * 0.02,
      0.009,
      {
        color: '#c48a48',
      },
    );
  }
  bowl(x - 0.095, z - 0.04, '#2c2622', '#8a5226');
  const pepper = bowl(x + 0.095, z - 0.05, '#2c2622', '#4a3d1c');
  kit.sphere('gloss', x + 0.105, pepper + 0.002, z - 0.055, 0.02, { sy: 0.45, color: '#f2c64a' });
  bowl(x - 0.13, z + 0.03, '#efe7d6', '#a8461f');
}

/** Theodora, Brooklyn: whipped ricotta piped over toast, with honey, black pepper and rosemary. */
function ricottaToast(kit: Kit, x: number, z: number): void {
  const ry = 0.45;
  // An oval stoneware dish: a terracotta edge around a pale grey glaze. Its long axis follows `ry`.
  kit.cylinder('matte', x, TOP, z, 0.11, 0.022, {
    segments: 12,
    depthScale: 1.9,
    ry: ry + Math.PI / 2,
    color: '#b0613c',
  });
  kit.cylinder('gloss', x, TOP + 0.012, z, 0.1, 0.012, {
    segments: 12,
    depthScale: 1.9,
    ry: ry + Math.PI / 2,
    color: '#d9d6cf',
  });
  const y = TOP + 0.024;
  kit.boxAt('matte', x, y + 0.012, z, 0.27, 0.024, 0.1, { ry, color: '#71472a' });
  // Ricotta piped across the toast in plump, soft ridges.
  const ridge = new RoundedBoxGeometry(0.028, 0.026, 0.088, 2, 0.012);
  for (let i = 0; i < 8; i++) {
    const [px, pz] = onAxis(x, z, ry, -0.105 + i * 0.03);
    kit.add('matte', ridge, at(px, y + 0.034, pz, { ry }), '#f8f5ee');
  }
  const random = createRandom(31);
  for (let i = 0; i < 14; i++) {
    const [px, pz] = onAxis(x, z, ry, (random() - 0.5) * 0.24, (random() - 0.5) * 0.07);
    kit.sphere('matte', px, y + 0.041, pz, 0.003, { color: '#2a2622' });
  }
  for (const [along, across, turn] of [
    [-0.06, 0.0, 0.6],
    [0.04, 0.01, -0.5],
  ] as const) {
    const [ax, az] = onAxis(x, z, ry, along - 0.025, across - 0.02);
    const [bx, bz] = onAxis(x, z, ry, along + 0.025, across + 0.02 * Math.sign(turn));
    kit.rod('matte', new Vector3(ax, y + 0.041, az), new Vector3(bx, y + 0.043, bz), 0.003, 3);
  }
  // Honey pooling on the dish beside the toast.
  const [hx, hz] = onAxis(x, z, ry, 0.08, 0.07);
  kit.cylinder('gloss', hx, TOP + 0.024, hz, 0.012, 0.002, { color: '#c98f2e' });
}

/** Kasama, Chicago: a truffle croissant under pearl sugar, in its takeaway box. */
function truffleCroissant(kit: Kit, x: number, z: number): void {
  const kraft = '#b98d5c';
  const half = 0.13;
  const wall = 0.07;
  kit.boxAt('matte', x, TOP + 0.002, z, half * 2, 0.004, half * 2, { color: kraft });
  for (const [dx, dz, w, d] of [
    [0, -half, half * 2, 0.004],
    [0, half, half * 2, 0.004],
    [-half, 0, 0.004, half * 2],
    [half, 0, 0.004, half * 2],
  ] as const)
    kit.boxAt('matte', x + dx, TOP + wall / 2, z + dz, w, wall, d, { color: kraft });
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
  // The croissant: a plump crescent with its horns curling back, and a darker laminated band.
  const y = TOP + 0.006;
  const bend = 0.08;
  const cz = z - 0.035;
  const crescent = (tube: number, arc: number, color: string): void => {
    const geometry = new TorusGeometry(bend, tube, 6, 9, arc).rotateZ(Math.PI / 2 - arc / 2);
    kit.add('matte', geometry, at(x, y + tube * 0.8, cz, { rx: Math.PI / 2, sz: 0.8 }), color);
  };
  crescent(0.05, 2.6, '#c47a30');
  crescent(0.052, 0.5, '#d48c42');
  for (const side of [-1, 1]) {
    const a = Math.PI / 2 + side * 1.3;
    const hx = x + Math.cos(a) * bend;
    const hz = cz + Math.sin(a) * bend;
    kit.sphere('matte', hx, y + 0.02, hz, 0.03, { sy: 0.7, color: '#b86e2a' });
  }
  // Pearl sugar over the top, and a pinch of shaved truffle in the middle.
  const random = createRandom(53);
  for (let i = 0; i < 44; i++) {
    const a = Math.PI / 2 + (random() - 0.5) * 2.4;
    const r = bend + (random() - 0.5) * 0.05;
    kit.sphere('matte', x + Math.cos(a) * r, y + 0.08, cz + Math.sin(a) * r, 0.008, {
      color: '#f5f0e4',
    });
  }
  for (let i = 0; i < 7; i++)
    kit.boxAt(
      'matte',
      x + (random() - 0.5) * 0.035,
      y + 0.085,
      cz + bend + (random() - 0.5) * 0.02,
      0.012,
      0.002,
      0.006,
      {
        ry: random() * Math.PI,
        color: '#4e3d2a',
      },
    );
}

/** Where the plates stand along the pass, one under each heat lamp. */
const DISH_X = [-3, -1.5, 0, 1.5, 3] as const;
const FAVORITE_DISHES: readonly ((kit: Kit, x: number, z: number) => void)[] = [
  charSiu,
  beetroot,
  rotiAndDips,
  ricottaToast,
  truffleCroissant,
];

/** Le passe: plates under glowing heat lamps, and the ticket rail. */
function passe(kit: Kit): void {
  const p = KITCHEN.pass;
  const cz = (p.minZ + p.maxZ) / 2;
  // Gantry: steel posts carrying the lamp housing high enough to see under.
  const housing = 2.18;
  for (const x of [p.minX + 0.2, p.maxX - 0.2]) {
    kit.cylinder('steel', x, TOP, cz, 0.028, housing + 0.12 - TOP);
  }
  kit.box('steel', p.minX + 0.1, p.maxX - 0.1, housing, housing + 0.12, cz - 0.18, cz + 0.18);
  // One heat lamp over each plate.
  for (const x of DISH_X) {
    kit.add('steel', LAMP_SHADE, at(x, housing - 0.15, cz));
    kit.sphere('light', x, housing - 0.13, cz, 0.06, { sy: 0.7, color: BULB });
  }
  // Ticket rail along the kitchen side, with today's orders clipped on.
  const rail = housing - 0.06;
  kit.rod(
    'steel',
    new Vector3(p.minX + 0.3, rail, p.minZ - 0.02),
    new Vector3(p.maxX - 0.3, rail, p.minZ - 0.02),
    0.012,
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
  FAVORITE_DISHES.forEach((dish, i) => dish(kit, DISH_X[i]!, cz));
  // The service bell.
  kit.cylinder('brass', 3.6, TOP, cz, 0.06, 0.012, { segments: 24 });
  kit.sphere('brass', 3.6, TOP + 0.012, cz, 0.05, { sy: 0.8 });
  kit.cylinder('brass', 3.6, TOP + 0.05, cz, 0.008, 0.03, { segments: 8 });
  // A neat stack of side towels.
  for (let i = 0; i < 5; i++)
    kit.boxAt('matte', -3.6, TOP + 0.012 + i * 0.022, cz, 0.28, 0.02, 0.22, { color: '#f4f1ea' });
}

/** Where a station's centerpiece stands, from the shared layout. */
function stationAt(id: StationId): { x: number; z: number } {
  const station = STATIONS.find((s) => s.id === id)!;
  return { x: station.x, z: station.z };
}

/** Garde manger: a cheese under a glass cloche, a pâté en croûte, and oysters on ice. */
function gardeManger(kit: Kit): void {
  const { x: cx, z: cz } = stationAt('garde-manger');
  kit.cylinder('matte', cx, TOP, cz, 0.22, 0.03, { color: paint.wood });
  kit.cylinder('matte', cx, TOP + 0.03, cz, 0.13, 0.07, { color: '#efd38f' });
  kit.cylinder('matte', cx + 0.09, TOP + 0.03, cz - 0.1, 0.05, 0.06, {
    segments: 3,
    color: '#f2dba0',
    ry: 0.4,
  });
  kit.sphere('glass', cx, TOP + 0.03, cz, 0.19, { sy: 1.15 });
  kit.sphere('steel', cx, TOP + 0.255, cz, 0.022);
  kit.add(
    'steel',
    new TorusGeometry(0.19, 0.006, 3, 14),
    at(cx, TOP + 0.032, cz, { rx: Math.PI / 2 }),
  );

  // Pâté en croûte on a board along the island, two slices fanned out.
  const px = cx - 1.1;
  kit.boxAt('matte', px, TOP + 0.012, cz, 0.5, 0.025, 0.24, { color: paint.wood });
  kit.rounded('gloss', px - 0.05, TOP + 0.075, cz, 0.28, 0.1, 0.12, 0.015, '#c98a3e');
  for (let i = 0; i < 2; i++) {
    const x = px + 0.14 + i * 0.05;
    kit.boxAt('gloss', x, TOP + 0.03 + i * 0.012, cz, 0.1, 0.012, 0.12, {
      rz: -0.15,
      ry: 0.2,
      color: '#c98a3e',
    });
    kit.boxAt('matte', x, TOP + 0.037 + i * 0.012, cz, 0.075, 0.004, 0.09, {
      rz: -0.15,
      ry: 0.2,
      color: '#c9796e',
    });
  }

  // A platter of oysters on crushed ice.
  const ox = cx + 1.1;
  kit.cylinder('steel', ox, TOP, cz, 0.26, 0.03);
  kit.cylinder('matte', ox, TOP + 0.02, cz, 0.24, 0.02, { color: '#f4f7f8' });
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = i % 3 === 0 ? 0.08 : 0.17;
    kit.sphere('gloss', ox + Math.cos(a) * r, TOP + 0.05, cz + Math.sin(a) * r, 0.045, {
      sy: 0.32,
      sz: 0.7,
      ry: a,
      color: '#9a9590',
    });
  }
  kit.sphere('gloss', ox, TOP + 0.06, cz, 0.03, { color: '#f2cf3e' });
}

/** Pâtisserie: a croquembouche, macarons, and a stand mixer, with a marble slab for the pastry. */
function patisserie(kit: Kit): void {
  const { x: cx, z: cz } = stationAt('patisserie');
  // A marble slab set on the charcoal top: cool, for working butter into dough.
  kit.box('marble', cx - 1.6, cx + 1.7, TOP, TOP + 0.02, cz - 0.4, cz + 0.4);
  const top = TOP + 0.02;
  // The croquembouche: a cone of caramel-glazed choux on a silver base.
  kit.cylinder('steel', cx, top, cz, 0.22, 0.02);
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
      kit.sphere('gloss', cx + Math.cos(a) * ringRadius, y, cz + Math.sin(a) * ringRadius, 0.032, {
        color: random() < 0.5 ? '#d39a52' : '#c58640',
      });
    }
  }
  // Spun sugar winding around it.
  for (let i = 0; i < 40; i++) {
    const point = (t: number): Vector3 => {
      const a = t * Math.PI * 7;
      const r = 0.2 * (1 - t) + 0.03;
      return new Vector3(cx + Math.cos(a) * r, top + 0.06 + t * height, cz + Math.sin(a) * r);
    };
    kit.rod('brass', point(i / 40), point((i + 1) / 40), 0.0025, 4);
  }

  // Macarons in pastel rows on a tray.
  const tx = cx - 1.1;
  const tz = cz + 0.05;
  kit.box('steel', tx - 0.25, tx + 0.25, top, top + 0.012, tz - 0.17, tz + 0.17);
  const colors = ['#f4a6c6', '#b8e0b0', '#c9b6e8', '#f6e08c'];
  for (let row = 0; row < 4; row++) {
    for (let i = 0; i < 5; i++) {
      const x = tx - 0.19 + i * 0.095;
      const z = tz - 0.12 + row * 0.08;
      const color = colors[row]!;
      kit.cylinder('matte', x, top + 0.012, z, 0.032, 0.014, { color });
      kit.cylinder('matte', x, top + 0.026, z, 0.028, 0.008, { color: '#fbf3e4' });
      kit.cylinder('matte', x, top + 0.034, z, 0.032, 0.014, { color });
    }
  }

  // A cream stand mixer.
  const mx = cx + 1.0;
  const mz = cz - 0.1;
  kit.rounded('gloss', mx, top + 0.03, mz, 0.34, 0.06, 0.2, 0.025, paint.cream);
  kit.rounded('gloss', mx + 0.12, top + 0.2, mz, 0.11, 0.32, 0.13, 0.04, paint.cream);
  kit.rounded('gloss', mx - 0.02, top + 0.4, mz, 0.4, 0.13, 0.15, 0.06, paint.cream);
  kit.cylinder('steel', mx - 0.06, top + 0.06, mz, 0.085, 0.15, { taper: 1.25 });
  kit.rod(
    'steel',
    new Vector3(mx - 0.06, top + 0.34, mz),
    new Vector3(mx - 0.06, top + 0.14, mz),
    0.008,
  );

  // A rolling pin in a dusting of flour.
  const rx = cx + 1.55;
  kit.cylinder('matte', rx, top + 0.001, cz + 0.15, 0.18, 0.002, { color: '#fbfaf6' });
  kit.cylinder('matte', rx, top + 0.03, cz - 0.08, 0.03, 0.46, {
    rx: Math.PI / 2,
    color: paint.woodLight,
  });
}

/** Plonge: the pre-rinse spray over the dish pit's sink, and clean plates and glasses. */
function plonge(kit: Kit): void {
  const { x: cx } = stationAt('plonge');
  // The counter is against the south wall; the room is to the north (-Z).
  const back = KITCHEN.plonge.maxZ - 0.1;
  const out = -1;
  // The pre-rinse unit: a tall riser, an arched head, a spring-hung spray, and a swing faucet.
  kit.cylinder('steel', cx, TOP, back, 0.025, 1.1);
  kit.add(
    'steel',
    new TorusGeometry(0.16, 0.018, 3, 14, Math.PI),
    at(cx, TOP + 1.1, back + out * 0.16, { ry: Math.PI / 2 }),
  );
  const hose = back + out * 0.32;
  kit.cylinder('steel', cx, TOP + 0.45, hose, 0.016, 0.65);
  for (let i = 0; i < 14; i++) {
    kit.add(
      'steel',
      new TorusGeometry(0.03, 0.006, 3, 12),
      at(cx, TOP + 0.55 + i * 0.035, hose, { rx: Math.PI / 2 }),
    );
  }
  kit.cylinder('iron', cx, TOP + 0.33, hose, 0.035, 0.12);
  kit.cylinder('steel', cx, TOP + 0.3, hose, 0.045, 0.03);
  kit.rod(
    'steel',
    new Vector3(cx, TOP + 0.65, back),
    new Vector3(cx, TOP + 0.65, back + out * 0.3),
    0.015,
  );

  // Clean plates stacked between the sinks, and a rack of glasses over the other one.
  for (const [x, count] of [
    [6.05, 16],
    [6.4, 11],
  ] as const) {
    for (let i = 0; i < count; i++) {
      kit.cylinder('gloss', x, TOP + 0.02 + i * 0.018, 6.18, 0.15, 0.014, {
        color: paint.porcelain,
      });
    }
  }
  kit.box('steel', 4.85, 5.75, TOP + 0.02, TOP + 0.03, 5.98, 6.36);
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < 3; k++) {
      kit.cylinder('glass', 5.0 + i * 0.3, TOP + 0.03, 6.06 + k * 0.12, 0.04, 0.14);
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
