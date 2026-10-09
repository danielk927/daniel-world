/**
 * GLSL for painting textures that tile: hashes, gradient noise on a lattice that wraps, fractal
 * noise built from it, and cells (Worley noise) on a wrapping grid. Every function takes texture
 * coordinates across one repeat, in [0, 1), and a whole number of lattice cells across it, so what
 * it paints at u = 1 matches what it paints at u = 0.
 */
export const NOISE_GLSL = /* glsl */ `
// Hashes without sine (after Dave Hoskins), so they agree on every GPU.
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
vec3 hash32(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yzz) * p3.zyx);
}

// Gradient noise over p, on a lattice that wraps every period cells. About -1 to 1.
float gnoise(vec2 p, vec2 period) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 g00 = hash22(mod(i, period)) * 2.0 - 1.0;
  vec2 g10 = hash22(mod(i + vec2(1.0, 0.0), period)) * 2.0 - 1.0;
  vec2 g01 = hash22(mod(i + vec2(0.0, 1.0), period)) * 2.0 - 1.0;
  vec2 g11 = hash22(mod(i + vec2(1.0, 1.0), period)) * 2.0 - 1.0;
  float n00 = dot(g00, f);
  float n10 = dot(g10, f - vec2(1.0, 0.0));
  float n01 = dot(g01, f - vec2(0.0, 1.0));
  float n11 = dot(g11, f - vec2(1.0, 1.0));
  return 1.4142 * mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y);
}

// Fractal noise across one repeat: the first octave has cells lattice cells across it, each next
// one twice as many at gain times the strength. About -1 to 1.
float fbm(vec2 uv, vec2 cells, int octaves, float gain) {
  float sum = 0.0;
  float amplitude = 1.0;
  float total = 0.0;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amplitude * gnoise(uv * cells + float(i) * 17.31, cells);
    total += amplitude;
    cells *= 2.0;
    amplitude *= gain;
  }
  return sum / total;
}

// Cells across one repeat, n of them each way: (distance to the nearest point, to the second
// nearest, in cells), and the nearest point's cell, wrapped into the grid.
vec4 cells(vec2 uv, vec2 n) {
  vec2 p = uv * n;
  vec2 i = floor(p);
  vec2 f = fract(p);
  float f1 = 8.0;
  float f2 = 8.0;
  vec2 id = vec2(0.0);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 o = vec2(float(x), float(y));
      vec2 c = mod(i + o, n);
      vec2 d = o + hash22(c) - f;
      float dist = length(d);
      if (dist < f1) {
        f2 = f1;
        f1 = dist;
        id = c;
      } else if (dist < f2) {
        f2 = dist;
      }
    }
  }
  return vec4(f1, f2, id);
}

// The shortest way from b to a on a torus one repeat across.
vec2 wrapDelta(vec2 a, vec2 b) {
  vec2 d = a - b;
  return d - floor(d + 0.5);
}

// Distance from p to the segment from a to b, on the torus.
float segmentDistance(vec2 p, vec2 a, vec2 b) {
  vec2 pa = wrapDelta(p, a);
  vec2 ba = b - a;
  float t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * t);
}
`;
