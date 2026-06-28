import { describe, expect, test } from "bun:test";
import { BlockId } from "@/lib/world";
import { FORTUNE_BONUS_PER_LEVEL } from "@/lib/game/config";
import { rollBlockDrops } from "@/lib/game/items";

/** Count of `itemId` across a drop list (0 if absent). */
function dropCount(drops: Array<{ itemId: string; count: number }>, itemId: string): number {
  return drops.find((d) => d.itemId === itemId)?.count ?? 0;
}

describe("rollBlockDrops Fortune", () => {
  test("Fortune adds a bonus to ore drops, scaled by level", () => {
    const rng = () => 0.999; // max bonus roll
    // No Fortune → a single diamond.
    expect(dropCount(rollBlockDrops(BlockId.DiamondOre, rng), "diamond_ore")).toBe(1);
    // Fortune 3 → 1 + floor(0.999 × (3 × 1 + 1)) = 1 + 3.
    expect(dropCount(rollBlockDrops(BlockId.DiamondOre, rng, 3), "diamond_ore")).toBe(1 + 3 * FORTUNE_BONUS_PER_LEVEL);
    // Coal ore (drops the coal item) is an ore too.
    expect(dropCount(rollBlockDrops(BlockId.CoalOre, rng, 3), "coal")).toBe(1 + 3 * FORTUNE_BONUS_PER_LEVEL);
  });

  test("Fortune does not multiply non-ore blocks", () => {
    // rng 0 keeps stone/planks at one and lets the leaves chance-sapling drop.
    const rng = () => 0;
    expect(dropCount(rollBlockDrops(BlockId.Stone, rng, 3), "stone")).toBe(1);
    expect(dropCount(rollBlockDrops(BlockId.Planks, rng, 3), "planks")).toBe(1);
    // Leaves still drop only their single chance sapling — Fortune leaves it untouched.
    expect(dropCount(rollBlockDrops(BlockId.Leaves, rng, 3), "sapling")).toBe(1);
  });

  test("Fortune level 0 (default) is the plain single ore drop", () => {
    const rng = () => 0.999;
    expect(dropCount(rollBlockDrops(BlockId.GoldOre, rng, 0), "gold_ore")).toBe(1);
    expect(dropCount(rollBlockDrops(BlockId.GoldOre, rng), "gold_ore")).toBe(1);
  });
});
