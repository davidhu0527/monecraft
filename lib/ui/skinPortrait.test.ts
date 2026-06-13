import { describe, expect, test } from "bun:test";
import { renderSkinPortraitPixels } from "./skinPortrait";
import { SKIN_PRESETS } from "@/lib/game/playerSkins";
import { SPRITE_SIZE } from "./spritePixels";

function opaqueCount(pixels: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] === 255) count += 1;
  }
  return count;
}

function pixelAt(pixels: Uint8ClampedArray, x: number, y: number): [number, number, number] {
  const i = (y * SPRITE_SIZE + x) * 4;
  return [pixels[i], pixels[i + 1], pixels[i + 2]];
}

describe("skin portraits", () => {
  test("every preset renders a substantial deterministic 16x16 bust", () => {
    for (const preset of SKIN_PRESETS) {
      const pixels = renderSkinPortraitPixels(preset.palette);
      expect(pixels.length).toBe(SPRITE_SIZE * SPRITE_SIZE * 4);
      expect(opaqueCount(pixels)).toBeGreaterThan(40);
      expect(renderSkinPortraitPixels(preset.palette)).toEqual(pixels);
    }
  });

  test("all six portraits are pairwise distinct", () => {
    const rendered = SKIN_PRESETS.map((preset) => renderSkinPortraitPixels(preset.palette).join(","));
    expect(new Set(rendered).size).toBe(SKIN_PRESETS.length);
  });

  test("hair, eye, and shirt rows use the preset's palette colors", () => {
    const preset = SKIN_PRESETS.find((entry) => entry.id === "alex")!;
    const { hair, shirt, eyeWhite } = preset.palette;
    const pixels = renderSkinPortraitPixels(preset.palette);
    expect(pixelAt(pixels, 8, 2)).toEqual([(hair >> 16) & 255, (hair >> 8) & 255, hair & 255]);
    expect(pixelAt(pixels, 6, 6)).toEqual([(eyeWhite >> 16) & 255, (eyeWhite >> 8) & 255, eyeWhite & 255]);
    expect(pixelAt(pixels, 8, 14)).toEqual([(shirt >> 16) & 255, (shirt >> 8) & 255, shirt & 255]);
  });
});
