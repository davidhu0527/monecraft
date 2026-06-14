import { describe, expect, test } from "bun:test";
import { renderHudIconPixels, type HudIconName } from "@/lib/ui/hudPixels";
import { SPRITE_SIZE } from "@/lib/ui/spritePixels";

const ALL_ICONS: HudIconName[] = [
  "heart_full",
  "heart_half",
  "heart_container",
  "hunger_full",
  "hunger_half",
  "hunger_container",
  "armor_full",
  "armor_half",
  "armor_container",
  "bubble_full",
  "bubble_half",
  "bubble_container"
];

function opaquePixelCount(pixels: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) count += 1;
  return count;
}

describe("renderHudIconPixels", () => {
  test("every icon renders non-empty 16x16 pixels", () => {
    for (const name of ALL_ICONS) {
      const pixels = renderHudIconPixels(name);
      expect(pixels.length).toBe(SPRITE_SIZE * SPRITE_SIZE * 4);
      expect(opaquePixelCount(pixels)).toBeGreaterThan(20);
    }
  });

  test("full, half, and container variants differ", () => {
    expect(renderHudIconPixels("heart_full")).not.toEqual(renderHudIconPixels("heart_container"));
    expect(renderHudIconPixels("heart_half")).not.toEqual(renderHudIconPixels("heart_full"));
    expect(renderHudIconPixels("heart_half")).not.toEqual(renderHudIconPixels("heart_container"));
    expect(renderHudIconPixels("bubble_full")).not.toEqual(renderHudIconPixels("bubble_container"));
    expect(renderHudIconPixels("bubble_half")).not.toEqual(renderHudIconPixels("bubble_full"));
  });

  test("the half heart keeps the full color only on the left side", () => {
    const half = renderHudIconPixels("heart_half");
    const full = renderHudIconPixels("heart_full");
    const container = renderHudIconPixels("heart_container");
    const mid = 6; // row 6 crosses the heart body
    const leftIdx = (mid * SPRITE_SIZE + 3) * 4;
    const rightIdx = (mid * SPRITE_SIZE + 12) * 4;
    expect(half[leftIdx]).toBe(full[leftIdx]);
    expect(half[rightIdx]).toBe(container[rightIdx]);
  });
});
