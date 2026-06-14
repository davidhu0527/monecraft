import { describe, expect, test } from "bun:test";
import { BlockId } from "@/lib/world";
import { ITEM_DEFS } from "@/lib/game/items";
import { MATERIAL_PALETTES, paintGrid, paintIsoBlock, renderSpritePixels, SPRITE_SIZE } from "@/lib/ui/spritePixels";

function opaquePixelCount(pixels: Uint8ClampedArray): number {
  let count = 0;
  for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) count += 1;
  return count;
}

describe("renderSpritePixels", () => {
  // Integrity-style: every registered item must produce a real sprite, so a
  // new ITEM_DEFS entry without icon coverage fails here instead of falling
  // back to the magenta checker silently.
  test("every item def yields a non-empty 16x16 sprite", () => {
    const placeholder = renderSpritePixels("no_such_item");
    for (const def of ITEM_DEFS) {
      const pixels = renderSpritePixels(def.id);
      expect(pixels.length).toBe(SPRITE_SIZE * SPRITE_SIZE * 4);
      expect(opaquePixelCount(pixels)).toBeGreaterThan(20);
      expect(pixels).not.toEqual(placeholder); // no item may fall back to the checker
    }
  });

  test("is deterministic", () => {
    expect(renderSpritePixels("diamond_sword")).toEqual(renderSpritePixels("diamond_sword"));
    expect(paintIsoBlock(BlockId.Grass)).toEqual(paintIsoBlock(BlockId.Grass));
  });

  test("material tiers produce different sprites for the same shape", () => {
    expect(renderSpritePixels("wood_pickaxe")).not.toEqual(renderSpritePixels("diamond_pickaxe"));
    expect(renderSpritePixels("wood_sword")).not.toEqual(renderSpritePixels("gold_sword"));
    expect(renderSpritePixels("wood_spear")).not.toEqual(renderSpritePixels("diamond_spear"));
  });

  test("spears have a distinct silhouette from swords", () => {
    expect(renderSpritePixels("stone_spear")).not.toEqual(renderSpritePixels("stone_sword"));
  });

  test("the knife silhouette is distinct from every sword", () => {
    const knife = renderSpritePixels("knife");
    for (const def of ITEM_DEFS) {
      if (!def.id.endsWith("_sword")) continue;
      const sword = renderSpritePixels(def.id);
      expect(knife).not.toEqual(sword);
      // The knife has no crossguard: the sword's wide row 10 stays narrow.
      const rowWidth = (pixels: Uint8ClampedArray, y: number) => {
        let count = 0;
        for (let x = 0; x < SPRITE_SIZE; x += 1) if (pixels[(y * SPRITE_SIZE + x) * 4 + 3] > 0) count += 1;
        return count;
      };
      expect(rowWidth(knife, 10)).toBeLessThan(rowWidth(sword, 10));
    }
  });

  test("every tool/weapon material prefix has a palette", () => {
    // The knife and bow render from their own custom grids, not the shared
    // tool/sword grid + material-prefix palette, so they are exempt.
    const customGrid = new Set(["knife", "bow"]);
    for (const def of ITEM_DEFS) {
      if (def.kind !== "tool" && (def.kind !== "weapon" || customGrid.has(def.id))) continue;
      expect(MATERIAL_PALETTES[def.id.split("_")[0]]).toBeDefined();
    }
  });

  test("unknown ids fall back to the placeholder checker", () => {
    const pixels = renderSpritePixels("no_such_item");
    expect(opaquePixelCount(pixels)).toBeGreaterThan(0);
  });
});

describe("paintIsoBlock", () => {
  test("top face is brighter than the right face", () => {
    const pixels = paintIsoBlock(BlockId.Stone);
    const at = (x: number, y: number) => {
      const i = (y * SPRITE_SIZE + x) * 4;
      return pixels[i] + pixels[i + 1] + pixels[i + 2];
    };
    // (8, 4) sits on the top face; (12, 10) on the right face.
    expect(at(8, 4)).toBeGreaterThan(at(12, 10));
  });

  test("ore cubes differ from plain stone", () => {
    expect(paintIsoBlock(BlockId.DiamondOre)).not.toEqual(paintIsoBlock(BlockId.Stone));
  });

  test("corners stay transparent", () => {
    const pixels = paintIsoBlock(BlockId.Dirt);
    expect(pixels[3]).toBe(0); // top-left corner alpha
    expect(pixels[(SPRITE_SIZE - 1) * 4 + 3]).toBe(0); // top-right corner alpha
  });
});

describe("paintGrid", () => {
  test("maps palette characters and leaves dots transparent", () => {
    const pixels = paintGrid(["xx", ".x"], { x: [10, 20, 30] });
    expect([pixels[0], pixels[1], pixels[2], pixels[3]]).toEqual([10, 20, 30, 255]);
    expect(pixels[(SPRITE_SIZE + 0) * 4 + 3]).toBe(0); // row 1 col 0 is "."
  });
});
