/**
 * Pure, deterministic star-direction generator (no Three.js, unit-tested).
 * Returns `count` points on the upper unit sphere, which skyView.ts scales out
 * to a large radius and follows the camera.
 */

function hash01(n: number, seed: number): number {
  const v = Math.sin((n + 1) * 12.9898 + seed * 78.233) * 43758.5453;
  return v - Math.floor(v);
}

export function generateStarPositions(count: number, seed: number): Float32Array {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const theta = hash01(i * 2 + 1, seed) * Math.PI * 2;
    // Bias toward overhead (y in 0.08..0.98) so stars don't clutter the horizon.
    const y = 0.08 + hash01(i * 2 + 2, seed) * 0.9;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    out[i * 3] = Math.cos(theta) * r;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = Math.sin(theta) * r;
  }
  return out;
}
