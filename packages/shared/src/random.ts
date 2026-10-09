/** Small deterministic PRNG (mulberry32) so client and server generate identical layouts. */
export function createRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A number in [0, 1) decided by three integers and nothing else, so machines that share no state
 * still draw the same one. Integer arithmetic only, which every engine does exactly alike.
 */
export function hashRandom(a: number, b: number, c: number): number {
  return mix(mix(mix(a ^ 0x9e3779b9) ^ b) ^ c) / 4294967296;
}

/** Murmur3's finalizer: each bit of `h` flips about half the bits of the result. */
function mix(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
