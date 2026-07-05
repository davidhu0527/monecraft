import { describe, expect, test } from "bun:test";
import { CHEST_SLOTS } from "@/lib/game/config";
import { createEmptySlot, createSlot, ITEM_DEF_BY_ID } from "@/lib/game/items";
import { tryInsertSlots } from "@/lib/game/inventory";
import { seededRng, type LootTier } from "@/lib/game/dungeonLoot";
import { BURIED_TREASURE_LOOT, rollBuriedTreasureLoot } from "@/lib/game/buriedTreasureLoot";

const ALL_TIERS = Object.keys(BURIED_TREASURE_LOOT) as LootTier[];

describe("buried treasure loot tables", () => {
  test("every loot entry references an existing item with a sane range", () => {
    for (const tier of ALL_TIERS) {
      for (const entry of BURIED_TREASURE_LOOT[tier]) {
        expect(ITEM_DEF_BY_ID[entry.itemId]).toBeDefined();
        expect(entry.min).toBeLessThanOrEqual(entry.max);
        expect(entry.min).toBeGreaterThanOrEqual(0);
        if (entry.chance !== undefined) {
          expect(entry.chance).toBeGreaterThan(0);
          expect(entry.chance).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  test("rolling the same seed yields identical loot (reproducible until dug up)", () => {
    const loot1 = rollBuriedTreasureLoot(seededRng(0x1234));
    const loot2 = rollBuriedTreasureLoot(seededRng(0x1234));
    expect(loot1).toEqual(loot2);
  });

  test("emeralds always drop — a dug-up hoard is never empty", () => {
    const highRoll = rollBuriedTreasureLoot(() => 0.999);
    expect(highRoll.some((d) => d.itemId === "emerald")).toBe(true);
    const lowRoll = rollBuriedTreasureLoot(() => 0);
    expect(lowRoll.some((d) => d.itemId === "emerald")).toBe(true);
    expect(lowRoll.some((d) => d.itemId === "diamond_ore")).toBe(true); // rare tier opened
  });

  test("a roll can never overflow a chest, so loot is never silently dropped", () => {
    const maxEntries = BURIED_TREASURE_LOOT.common.length + BURIED_TREASURE_LOOT.rare.length;
    expect(maxEntries).toBeLessThanOrEqual(CHEST_SLOTS);

    const rng = seededRng(0xfeed);
    for (let i = 0; i < 500; i += 1) {
      const incoming = rollBuriedTreasureLoot(rng).map((drop) => createSlot(drop.itemId, drop.count));
      const slots = Array.from({ length: CHEST_SLOTS }, () => createEmptySlot());
      expect(tryInsertSlots(slots, incoming)).not.toBeNull();
    }
  });
});
