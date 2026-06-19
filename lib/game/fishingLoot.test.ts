import { describe, expect, test } from "bun:test";
import { ITEM_DEF_BY_ID } from "@/lib/game/items";
import { FISHING_LOOT, rollFishingCatch } from "@/lib/game/fishingLoot";

/** rng that yields a fixed sequence, then repeats the last value. */
function seq(...values: number[]): () => number {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}

describe("fishing loot", () => {
  test("every loot entry references a real item", () => {
    for (const entry of FISHING_LOOT) {
      expect(ITEM_DEF_BY_ID[entry.itemId], entry.itemId).toBeDefined();
    }
  });

  test("a roll always yields exactly one catch of a real item with a positive count", () => {
    for (let i = 0; i <= 20; i += 1) {
      const result = rollFishingCatch(seq(i / 20, 0.5));
      expect(result).toHaveLength(1);
      expect(ITEM_DEF_BY_ID[result[0].itemId]).toBeDefined();
      expect(result[0].count).toBeGreaterThanOrEqual(1);
    }
  });

  test("a low roll yields the common raw fish", () => {
    expect(rollFishingCatch(seq(0, 0))).toEqual([{ itemId: "raw_fish", count: 1 }]);
  });

  test("a high roll reaches the rare treasure tier", () => {
    // Weights sum to 100; the treasure entries sit at the top of the range.
    const result = rollFishingCatch(seq(0.99, 0));
    expect(["emerald", "leather"]).toContain(result[0].itemId);
  });
});
