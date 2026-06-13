import { describe, expect, test } from "bun:test";
import { hexToRgb } from "@/lib/game/render/particleSystem";

describe("hexToRgb", () => {
  test("splits a hex int into 0..1 channels", () => {
    expect(hexToRgb(0xffffff)).toEqual([1, 1, 1]);
    expect(hexToRgb(0x000000)).toEqual([0, 0, 0]);
  });

  test("matches a mob body color (zombie green)", () => {
    const [r, g, b] = hexToRgb(0x669e57);
    expect(r).toBeCloseTo(0x66 / 255, 5);
    expect(g).toBeCloseTo(0x9e / 255, 5);
    expect(b).toBeCloseTo(0x57 / 255, 5);
  });
});
