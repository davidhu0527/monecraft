import { describe, expect, test } from "bun:test";
import { generateStarPositions } from "@/lib/game/render/starField";

describe("generateStarPositions", () => {
  test("returns count*3 floats", () => {
    expect(generateStarPositions(800, 1).length).toBe(2400);
  });

  test("is deterministic for a seed and varies by seed", () => {
    const a = generateStarPositions(64, 7);
    const b = generateStarPositions(64, 7);
    const c = generateStarPositions(64, 8);
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  test("places every star on the unit sphere, above the horizon", () => {
    const p = generateStarPositions(200, 3);
    for (let i = 0; i < 200; i += 1) {
      const x = p[i * 3];
      const y = p[i * 3 + 1];
      const z = p[i * 3 + 2];
      expect(Math.hypot(x, y, z)).toBeCloseTo(1, 4);
      expect(y).toBeGreaterThan(0);
    }
  });
});
