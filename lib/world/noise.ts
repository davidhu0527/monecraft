/**
 * Bit-portable noise and trig for seed-determined code (worldgen, biomes,
 * weather windows, daylight). ECMA-262 leaves Math.sin/cos implementation-
 * defined, so two JS engines can disagree in the last bits — enough to flip a
 * Math.floor and change generated world bytes for the same seed. Everything
 * here uses only operations IEEE 754 specifies exactly (+, -, *, /,
 * Math.floor, Math.imul, bit ops), so a Bun/Node server and any browser
 * generate identical worlds from a seed. Frame-local gameplay math (aiming,
 * mob steering, doors) may keep native Math trig: it never feeds
 * seed-determined bytes. See docs/testing.md.
 */

const TWO_PI = 6.283185307179586;
const INV_TWO_PI = 1 / TWO_PI;

// Taylor coefficients for sin on [0, π/2]; degree 11 keeps the truncation
// error (< 6e-8 at π/2) far below anything terrain math can observe. Exact
// rationals, so no dependence on someone's minimax tables.
const S3 = -1 / 6;
const S5 = 1 / 120;
const S7 = -1 / 5040;
const S9 = 1 / 362880;
const S11 = -1 / 39916800;

/**
 * sin(x), engine-portable. Range-reduces to a quarter wave with Math.floor,
 * then evaluates an odd degree-11 polynomial. |error| < 1e-7 vs true sine —
 * visually identical, but bit-identical across engines.
 */
export function portableSin(x: number): number {
  let t = x * INV_TWO_PI; // turns
  t -= Math.floor(t); // [0, 1)
  let sign = 1;
  if (t >= 0.5) {
    // sin(θ + π) = -sin θ
    t -= 0.5;
    sign = -1;
  }
  if (t > 0.25) t = 0.5 - t; // fold the second quarter back onto the first
  const u = t * TWO_PI; // [0, π/2]
  const u2 = u * u;
  return sign * u * (1 + u2 * (S3 + u2 * (S5 + u2 * (S7 + u2 * (S9 + u2 * S11)))));
}

/** cos(x), engine-portable (quarter-turn phase shift of portableSin). */
export function portableCos(x: number): number {
  return portableSin(x + TWO_PI * 0.25);
}

/** 32-bit avalanche hash (xorshift-multiply); uniform in [0, 2^32). */
export function hashU32(v: number): number {
  let h = v | 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Deterministic [0, 1) from two (possibly fractional) block coordinates.
 * Coordinates are quantized to 1/4096 of a block before hashing; worldgen
 * callers pass values well inside int32 after scaling.
 */
export function hash2D(x: number, z: number): number {
  const xi = Math.floor(x * 4096) | 0;
  const zi = Math.floor(z * 4096) | 0;
  return hashU32((Math.imul(xi, 0x9e3779b1) ^ Math.imul(zi, 0x85ebca6b)) | 0) / 4294967296;
}

/** Deterministic [0, 1) from an integer index plus a seed (weather windows). */
export function hash01(n: number, seed: number): number {
  return hashU32((Math.imul(n | 0, 0x9e3779b1) ^ Math.imul(seed | 0, 0x85ebca6b)) | 0) / 4294967296;
}
