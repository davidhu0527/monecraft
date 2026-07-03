import { describe, expect, test } from "bun:test";
import { hash01, hash2D, hashU32, portableCos, portableSin } from "./noise";

/**
 * portableSin/portableCos accuracy is checked against native Math.sin — not for
 * exactness (the whole point is NOT matching an engine-defined function) but to
 * pin that the polynomial is a faithful sine. The golden-value tests pin exact
 * doubles: if they ever fail on some runtime, that runtime broke the
 * cross-engine determinism contract worldgen depends on (see docs/testing.md).
 */

describe("portableSin", () => {
  test("stays within 1e-6 of a true sine across many periods", () => {
    let maxErr = 0;
    for (let i = -3000; i <= 3000; i += 1) {
      const x = i * 0.0173; // irrational-ish stride, ~±52 rad
      maxErr = Math.max(maxErr, Math.abs(portableSin(x) - Math.sin(x)));
    }
    expect(maxErr).toBeLessThan(1e-6);
  });

  test("cos matches sin's quarter-turn shift and stays within 1e-6", () => {
    let maxErr = 0;
    for (let i = -1000; i <= 1000; i += 1) {
      const x = i * 0.041;
      maxErr = Math.max(maxErr, Math.abs(portableCos(x) - Math.cos(x)));
    }
    expect(maxErr).toBeLessThan(1e-6);
  });

  test("anchor points (within the polynomial's ~6e-8 truncation error)", () => {
    expect(portableSin(0)).toBe(0);
    expect(Math.abs(portableSin(Math.PI / 2) - 1)).toBeLessThan(1e-7);
    expect(Math.abs(portableSin(-Math.PI / 2) + 1)).toBeLessThan(1e-7);
    expect(Math.abs(portableCos(0) - 1)).toBeLessThan(1e-7);
  });

  test("is periodic across whole turns", () => {
    // Adding 8π in doubles rounds away low bits of the addend, so this can't
    // be a bit-exact comparison — but it must agree to float-addition noise.
    expect(portableSin(1.25)).toBeCloseTo(portableSin(1.25 + 6.283185307179586 * 4), 12);
  });

  test("golden values are bit-stable (cross-engine determinism pin)", () => {
    // Doubles printed with full precision; any engine that disagrees on these
    // would generate different worlds from the same seed.
    expect(portableSin(1)).toBe(0.841470984648068);
    expect(portableSin(12.34)).toBe(-0.22444221895185518);
    expect(portableSin(-77.7)).toBe(-0.7445205210032748);
    expect(portableCos(3.21)).toBe(-0.9976610981993939);
  });
});

describe("hashes", () => {
  test("hashU32 avalanche: adjacent inputs decorrelate", () => {
    const a = hashU32(1);
    const b = hashU32(2);
    expect(a).not.toBe(b);
    // Hamming distance of adjacent hashes should be substantial.
    let bits = (a ^ b) >>> 0;
    let count = 0;
    while (bits) {
      count += bits & 1;
      bits >>>= 1;
    }
    expect(count).toBeGreaterThan(8);
  });

  test("hash2D is deterministic, in [0,1), and sensitive to both axes", () => {
    expect(hash2D(12.7, -3.4)).toBe(hash2D(12.7, -3.4));
    expect(hash2D(12.7, -3.4)).not.toBe(hash2D(12.7, -3.3));
    expect(hash2D(12.7, -3.4)).not.toBe(hash2D(12.8, -3.4));
    for (let i = 0; i < 500; i += 1) {
      const v = hash2D(i * 1.7 + 11.3, i * 2.3 - 7.1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  test("hash2D distribution is roughly uniform (gate fractions hold)", () => {
    let above = 0;
    const n = 20000;
    for (let i = 0; i < n; i += 1) {
      if (hash2D(i * 0.37 + 0.05, i * 0.91 - 3.2) > 0.88) above += 1;
    }
    // 12% expected; allow generous slop — this pins "usable as a gate", not statistics.
    expect(above / n).toBeGreaterThan(0.09);
    expect(above / n).toBeLessThan(0.15);
  });

  test("hash01 depends on window index and seed", () => {
    expect(hash01(3, 1337)).toBe(hash01(3, 1337));
    expect(hash01(3, 1337)).not.toBe(hash01(4, 1337));
    expect(hash01(3, 1337)).not.toBe(hash01(3, 1338));
  });

  test("golden values are bit-stable (cross-engine determinism pin)", () => {
    expect(hashU32(1337)).toBe(2990212903);
    expect(hash2D(1.5, -2.25)).toBe(0.9197367669548839);
    expect(hash01(7, 424242)).toBe(0.8588354422245175);
  });
});
