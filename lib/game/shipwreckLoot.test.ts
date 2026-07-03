import { describe, expect, test } from "bun:test";
import { CHEST_SLOTS } from "@/lib/game/config";
import { createEmptySlot, createSlot, ITEM_DEF_BY_ID } from "@/lib/game/items";
import { tryInsertSlots } from "@/lib/game/inventory";
import { seededRng, type LootTier } from "@/lib/game/dungeonLoot";
import { SHIPWRECK_LOOT, rollShipwreckLoot } from "@/lib/game/shipwreckLoot";

const ALL_TIERS = Object.keys(SHIPWRECK_LOOT) as LootTier[];

describe("shipwreck loot tables", () => {
  test("every loot entry references an existing item with a sane range", () => {
    for (const tier of ALL_TIERS) {
      for (const entry of SHIPWRECK_LOOT[tier]) {
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

  test("rolling the same seed yields identical loot (reproducible until opened)", () => {
    const loot1 = rollShipwreckLoot(seededRng(0x1234));
    const loot2 = rollShipwreckLoot(seededRng(0x1234));
    expect(loot1).toEqual(loot2);
  });

  test("a low roll opens the rare tier and yields minimum counts", () => {
    const loot = rollShipwreckLoot(() => 0);
    const byId = new Map(loot.map((d) => [d.itemId, d.count]));
    expect(byId.get("diamond_ore")).toBe(1); // rare entry, min 1
    expect(byId.get("planks")).toBe(2); // common guaranteed entry, min 2
    expect(byId.get("treasure_map")).toBe(1); // the map hunt starts here
  });

  test("a high roll stays common and drops only the guaranteed salvage", () => {
    const loot = rollShipwreckLoot(() => 0.999);
    expect(loot.some((d) => d.itemId === "treasure_map")).toBe(false); // chance-gated, skipped
    expect(loot.some((d) => d.itemId === "diamond_ore")).toBe(false); // not the rare tier
    expect(loot.some((d) => d.itemId === "planks")).toBe(true); // always drops
  });

  test("a roll can never overflow a chest, so loot is never silently dropped", () => {
    const maxEntries = SHIPWRECK_LOOT.common.length + SHIPWRECK_LOOT.rare.length;
    expect(maxEntries).toBeLessThanOrEqual(CHEST_SLOTS);

    const rng = seededRng(0xfeed);
    for (let i = 0; i < 500; i += 1) {
      const incoming = rollShipwreckLoot(rng).map((drop) => createSlot(drop.itemId, drop.count));
      const slots = Array.from({ length: CHEST_SLOTS }, () => createEmptySlot());
      expect(tryInsertSlots(slots, incoming)).not.toBeNull();
    }
  });

  test("counts are always positive", () => {
    const rng = seededRng(0xbeef);
    for (let i = 0; i < 200; i += 1) {
      for (const drop of rollShipwreckLoot(rng)) {
        expect(drop.count).toBeGreaterThan(0);
      }
    }
  });
});
