import type { Recipe } from './painter.ts';

/**
 * The kitchen's surfaces as texture recipes (see painter.ts), at their real sizes. Colors are
 * linear multipliers on each part's paint, near 1 where the paint should show as painted; heights
 * are in meters.
 */

/** Pale honed stone, 50 cm tiles with 3 mm of dark grout, four by four tiles to a repeat. */
export const FLOOR: Recipe = {
  meters: 2,
  colorSize: 1024,
  normalSize: 1024,
  glsl: /* glsl */ `
void surface(vec2 uv, out vec3 color, out float height, out float roughness) {
  vec2 t = uv * 4.0;
  vec2 cell = mod(floor(t), 4.0);
  vec2 f = fract(t);
  vec3 h = hash32(cell + 11.0);
  // Meters to the tile's nearest edge.
  vec2 e = min(f, 1.0 - f) * 0.5;
  float edge = min(e.x, e.y);
  float grout = 1.0 - smoothstep(0.0009, 0.0014, edge);
  // Stone: soft clouds, a fine speckle and the odd darker fleck of shell.
  float clouds = fbm(uv, vec2(5.0), 5, 0.55);
  float speck = fbm(uv, vec2(160.0), 2, 0.5);
  vec4 fleck = cells(uv, vec2(90.0));
  float shell = (1.0 - smoothstep(0.05, 0.16, fleck.x)) * step(0.82, hash12(fleck.zw));
  vec3 stone = vec3(0.86) * (1.0 + 0.07 * (h.x - 0.5)) * (1.0 + 0.05 * clouds + 0.035 * speck);
  stone *= mix(vec3(1.0), vec3(1.025, 1.0, 0.965), h.y);
  stone *= 1.0 - 0.22 * shell;
  color = mix(stone, vec3(0.42, 0.41, 0.39), grout);
  // The face lies a little off true (lippage), its edges eased over a few millimeters; grout sits 2 mm down.
  float face = (h.z - 0.5) * 0.0003 + (f.x - 0.5) * (h.x - 0.5) * 0.0004 + (f.y - 0.5) * (h.y - 0.5) * 0.0004;
  float ease = smoothstep(0.0012, 0.0045, edge);
  height = mix(-0.0018, face + 0.00002 * speck, ease);
  roughness = mix(0.3 + 0.1 * h.y + 0.05 * clouds + 0.08 * shell, 0.85, grout);
}
`,
};

/**
 * Large white glazed tiles, 60 by 30 cm, stacked with 2 mm of grout nearly their own color: calm
 * walls that leave the steel, the copper and the food to carry the room. Two across and four up to
 * a repeat. The glaze is satin, and no tile's face is quite flat, so reflections wander a little.
 */
export const WALL_TILE: Recipe = {
  meters: 1.2,
  colorSize: 1024,
  normalSize: 1024,
  glsl: /* glsl */ `
void surface(vec2 uv, out vec3 color, out float height, out float roughness) {
  vec2 t = vec2(uv.x * 2.0, uv.y * 4.0);
  vec2 cell = mod(floor(t), vec2(2.0, 4.0));
  vec2 f = fract(t);
  vec3 h = hash32(cell + 3.0);
  // Meters to the tile's nearest edge.
  vec2 e = vec2(min(f.x, 1.0 - f.x) * 0.6, min(f.y, 1.0 - f.y) * 0.3);
  float edge = min(e.x, e.y);
  float grout = 1.0 - smoothstep(0.0009, 0.0012, edge);
  // The glaze rounds over the tile's edge in the last couple of millimeters.
  float cushion = smoothstep(0.0009, 0.0028, edge);
  float wave = sin(6.2832 * (f.x * (0.4 + 0.5 * h.x) + h.y)) * sin(3.1416 * f.y) * 0.6
    + sin(6.2832 * (f.y * (0.3 + 0.4 * h.z) + h.x)) * 0.4;
  float glazeNoise = fbm(uv, vec2(10.0, 20.0), 4, 0.5);
  float face = -0.00035 * (1.0 - cushion) * (1.0 - cushion) + 0.00012 * wave + 0.00002 * glazeNoise;
  height = mix(-0.0007, face, smoothstep(0.0009, 0.0011, edge));
  vec3 glaze = vec3(0.92) * (1.0 + 0.02 * (h.z - 0.5)) * (1.0 + 0.006 * glazeNoise);
  glaze *= mix(vec3(1.0), vec3(1.01, 1.0, 0.98), h.x);
  float dirt = 0.5 + 0.5 * fbm(uv, vec2(6.0), 3, 0.5);
  color = mix(glaze, vec3(0.8, 0.78, 0.74) * (0.94 + 0.08 * dirt), grout);
  roughness = mix(0.26 + 0.06 * h.y + 0.02 * glazeNoise, 0.8, grout);
}
`,
};

/** Warm white matte paint over plaster: a faint cloudiness and the trowel's soft unevenness. */
export const PLASTER: Recipe = {
  meters: 2,
  colorSize: 512,
  normalSize: 512,
  glsl: /* glsl */ `
void surface(vec2 uv, out vec3 color, out float height, out float roughness) {
  float clouds = fbm(uv, vec2(3.0), 5, 0.55);
  float fine = fbm(uv, vec2(48.0), 3, 0.5);
  color = vec3(0.94) * (1.0 + 0.025 * clouds + 0.01 * fine);
  height = 0.00035 * fbm(uv, vec2(6.0), 5, 0.6) + 0.00003 * fine;
  roughness = 0.86 + 0.06 * clouds;
}
`,
};

/**
 * Brushed stainless: streaks along u at a fraction of a millimeter, softer smudges, and fine
 * scratches every which way that catch the light more sharply than the brushing round them.
 */
export const BRUSHED_STEEL: Recipe = {
  meters: 0.5,
  colorSize: 0,
  normalSize: 1024,
  glsl: /* glsl */ `
void surface(vec2 uv, out vec3 color, out float height, out float roughness) {
  float brush = fbm(uv, vec2(6.0, 900.0), 3, 0.55);
  float streak = fbm(uv, vec2(1.0, 24.0), 2, 0.5);
  float smudge = fbm(uv, vec2(4.0), 4, 0.5);
  float scratch = 0.0;
  for (int k = 0; k < 48; k++) {
    vec3 r = hash32(vec2(float(k), 7.0));
    vec2 a = r.xy;
    float angle = r.z * 6.2832;
    float len = 0.02 + 0.12 * hash12(vec2(float(k), 3.0));
    vec2 b = a + vec2(cos(angle), sin(angle)) * len;
    float d = segmentDistance(uv, a, b) * 0.5;
    scratch = max(scratch, (1.0 - smoothstep(0.00005, 0.00022, d)) * (0.35 + 0.65 * r.y));
  }
  color = vec3(1.0);
  height = 0.000004 * brush - 0.000006 * scratch;
  roughness = 0.32 + 0.035 * brush + 0.02 * streak + 0.06 * smoothstep(0.1, 0.8, smudge) - 0.1 * scratch;
}
`,
};

/**
 * A hood's baffle filter, one to a repeat: a flat steel frame round six slats folded into a
 * chevron, the dark of the duct showing in the folds and a film of grease dulling them.
 */
export const BAFFLE: Recipe = {
  meters: 0.58,
  colorSize: 512,
  normalSize: 512,
  glsl: /* glsl */ `
void surface(vec2 uv, out vec3 color, out float height, out float roughness) {
  // Meters to the filter's edge: a 3 cm frame.
  vec2 e = min(uv, 1.0 - uv) * 0.58;
  float frame = 1.0 - smoothstep(0.028, 0.032, min(e.x, e.y));
  float slat = fract(uv.y * 6.0);
  float fold = abs(slat - 0.5) * 2.0;
  float grease = smoothstep(-0.2, 0.7, fbm(uv, vec2(4.0), 4, 0.5));
  float brush = fbm(uv, vec2(4.0, 300.0), 2, 0.5);
  height = mix(-0.008 * (1.0 - fold), 0.002, frame);
  float valley = (1.0 - smoothstep(0.0, 0.18, fold)) * (1.0 - frame);
  color = vec3(0.92) * (1.0 - 0.75 * valley) * (1.0 - 0.18 * grease);
  roughness = 0.34 + 0.2 * grease + 0.03 * brush;
}
`,
};

/** Seasoned cast iron and black enamel: a mottled sheen and a fine pitting. */
export const CAST_IRON: Recipe = {
  meters: 0.5,
  colorSize: 512,
  normalSize: 512,
  glsl: /* glsl */ `
void surface(vec2 uv, out vec3 color, out float height, out float roughness) {
  float mottle = fbm(uv, vec2(6.0), 5, 0.55);
  vec4 pit = cells(uv, vec2(160.0));
  float pits = (1.0 - smoothstep(0.0, 0.35, pit.x)) * step(0.6, hash12(pit.zw));
  color = vec3(0.9) * (1.0 + 0.18 * mottle) * (1.0 - 0.25 * pits);
  height = -0.00004 * pits + 0.00001 * fbm(uv, vec2(64.0), 3, 0.5);
  roughness = 0.55 + 0.14 * mottle + 0.1 * pits;
}
`,
};

/** Hammered copper: shallow facets from the hammer, and a darker patina in clouds. */
export const COPPER: Recipe = {
  meters: 0.3,
  colorSize: 512,
  normalSize: 512,
  glsl: /* glsl */ `
void surface(vec2 uv, out vec3 color, out float height, out float roughness) {
  vec4 dent = cells(uv, vec2(26.0));
  float patina = smoothstep(0.15, 0.85, 0.5 + 0.5 * fbm(uv, vec2(3.0), 5, 0.55));
  float fine = fbm(uv, vec2(40.0), 3, 0.5);
  color = mix(vec3(1.0), vec3(0.62, 0.5, 0.46), patina * 0.75) * (1.0 + 0.04 * fine);
  height = 0.00045 * dent.x * dent.x;
  roughness = 0.2 + 0.12 * patina + 0.04 * fine;
}
`,
};

/** Brushed brass with a little tarnish. */
export const BRASS: Recipe = {
  meters: 0.3,
  colorSize: 512,
  normalSize: 512,
  glsl: /* glsl */ `
void surface(vec2 uv, out vec3 color, out float height, out float roughness) {
  float tarnish = smoothstep(0.2, 0.9, 0.5 + 0.5 * fbm(uv, vec2(3.0), 5, 0.55));
  float brush = fbm(uv, vec2(2.0, 300.0), 3, 0.5);
  color = mix(vec3(1.0), vec3(0.72, 0.66, 0.55), tarnish * 0.6) * (1.0 + 0.03 * brush);
  height = 0.000004 * brush;
  roughness = 0.26 + 0.14 * tarnish + 0.04 * brush;
}
`,
};

/**
 * Stone: a fine grain of crystals and veins wandering through it, painted dark for the islands'
 * honed charcoal tops and pale for the pastry slab's polished marble.
 */
export const STONE: Recipe = {
  meters: 1,
  colorSize: 1024,
  normalSize: 512,
  glsl: /* glsl */ `
void surface(vec2 uv, out vec3 color, out float height, out float roughness) {
  vec2 warp = vec2(fbm(uv, vec2(3.0), 5, 0.55), fbm(uv + 0.37, vec2(3.0), 5, 0.55));
  vec2 q = uv + 0.09 * warp;
  float wander = fbm(q, vec2(4.0), 4, 0.5);
  float main = abs(sin(6.2832 * (2.0 * q.x + q.y) + 2.2 * wander));
  float thin = abs(sin(6.2832 * (3.0 * q.x - 2.0 * q.y) + 3.1 * fbm(q, vec2(6.0), 4, 0.5)));
  // Veins in soft clouds of grey, a few with a finer line through them, fading in and out.
  float cloud = 1.0 - smoothstep(0.0, 0.42, main);
  float line = 1.0 - smoothstep(0.0, 0.05, main);
  float hair = 1.0 - smoothstep(0.0, 0.04, thin);
  float vein = cloud * 0.32 + line * 0.28 + hair * 0.14;
  vein *= smoothstep(-0.45, 0.5, fbm(uv, vec2(2.0), 3, 0.5));
  vec4 grain = cells(uv, vec2(220.0));
  float crystal = hash12(grain.zw);
  vec3 base = vec3(0.92) * (1.0 + 0.1 * (crystal - 0.5)) * (1.0 + 0.04 * wander);
  color = mix(base, vec3(0.55, 0.56, 0.58), clamp(vein, 0.0, 1.0));
  height = -0.000015 * smoothstep(0.0, 0.3, grain.x) * crystal;
  roughness = 0.42 + 0.08 * (crystal - 0.5) + 0.05 * vein;
}
`,
};

/** Butcher block: strips of maple 4 cm wide along u, their grain, glue lines and the odd joint. */
export const BUTCHER_BLOCK: Recipe = {
  meters: 0.5,
  colorSize: 1024,
  normalSize: 512,
  glsl: /* glsl */ `
void surface(vec2 uv, out vec3 color, out float height, out float roughness) {
  float strips = 12.0;
  float s = mod(floor(uv.y * strips), strips);
  float fy = fract(uv.y * strips);
  vec3 h = hash32(vec2(s, 5.0));
  float warp = fbm(vec2(uv.x, s / strips), vec2(3.0, strips), 4, 0.5);
  float bands = sin(6.2832 * (fy * (2.0 + 3.0 * h.x) + 1.6 * warp + h.y * 7.0));
  float lines = smoothstep(0.55, 1.0, bands);
  float figure = fbm(vec2(uv.x, uv.y), vec2(6.0, 48.0), 3, 0.5);
  // A joint across the strip, where two lengths of maple meet.
  float along = abs(fract(uv.x - h.z + 0.5) - 0.5) * 0.5;
  float joint = (1.0 - smoothstep(0.0002, 0.0005, along)) * step(0.45, h.x);
  float glue = 1.0 - smoothstep(0.0, 0.012, min(fy, 1.0 - fy));
  vec3 maple = vec3(0.62, 0.36, 0.17) * (0.82 + 0.3 * h.z) * mix(vec3(1.0), vec3(1.06, 0.97, 0.9), h.y);
  maple *= 1.0 - 0.18 * lines + 0.05 * figure;
  color = mix(maple, maple * 0.45, max(glue * 0.8, joint * 0.7));
  height = -0.00025 * glue - 0.00003 * lines - 0.0002 * joint;
  roughness = 0.5 + 0.08 * lines + 0.04 * figure + 0.2 * glue;
}
`,
};

/** Cloth and paper: a fine weave and loose fibers. */
export const CLOTH: Recipe = {
  meters: 0.25,
  colorSize: 512,
  normalSize: 512,
  glsl: /* glsl */ `
void surface(vec2 uv, out vec3 color, out float height, out float roughness) {
  float threads = 120.0;
  float warpThread = 0.5 + 0.5 * sin(6.2832 * uv.x * threads);
  float weftThread = 0.5 + 0.5 * sin(6.2832 * uv.y * threads);
  float over = step(0.5, fract((floor(uv.x * threads) + floor(uv.y * threads)) * 0.5));
  float weave = mix(warpThread, weftThread, over);
  float fibers = fbm(uv, vec2(24.0), 4, 0.6);
  color = vec3(0.95) * (1.0 + 0.04 * fibers - 0.04 * weave);
  height = 0.00012 * weave + 0.00004 * fibers;
  roughness = 0.82 + 0.08 * fibers;
}
`,
};

/** Food: a crumb of small pores and soft bumps, with its color browning unevenly. */
export const FOOD: Recipe = {
  meters: 0.1,
  colorSize: 512,
  normalSize: 512,
  glsl: /* glsl */ `
void surface(vec2 uv, out vec3 color, out float height, out float roughness) {
  vec4 pore = cells(uv, vec2(36.0));
  float pores = (1.0 - smoothstep(0.0, 0.32, pore.x)) * step(0.35, hash12(pore.zw));
  float bumps = fbm(uv, vec2(6.0), 5, 0.55);
  float browning = fbm(uv + 0.5, vec2(4.0), 4, 0.5);
  color = vec3(0.92) * (1.0 + 0.12 * browning) * (1.0 - 0.18 * pores);
  height = 0.0004 * bumps - 0.00025 * pores;
  roughness = 0.62 + 0.12 * pores - 0.06 * browning;
}
`,
};
