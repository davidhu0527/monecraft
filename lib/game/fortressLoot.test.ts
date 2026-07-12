import { describe, expect, test } from "bun:test";
import { CHEST_SLOTS } from "@/lib/game/config";
import { createEmptySlot, createSlot, ITEM_DEF_BY_ID } from "@/lib/game/items";
import { tryInsertSlots } from "@/lib/game/inventory";
import { seededRng, type LootTier } from "@/lib/game/dungeonLoot";
import { FORTRESS_LOOT, rollFortressLoot } from "@/lib/game/fortressLoot";

const ALL_TIERS = Object.keys(FORTRESS_LOOT) as LootTier[];

describe("fortress loot tables", () => {
  test("every loot entry references an existing item with a sane range", () => {
    for (const tier of ALL_TIERS) {
      for (const entry of FORTRESS_LOOT[tier]) {
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
    const loot1 = rollFortressLoot(seededRng(0x1234));
    const loot2 = rollFortressLoot(seededRng(0x1234));
    expect(loot1).toEqual(loot2);
  });

  test("a low roll opens the rare tier and yields minimum counts", () => {
    const loot = rollFortressLoot(() => 0);
    const byId = new Map(loot.map((d) => [d.itemId, d.count]));
    expect(byId.get("blazite_ore")).toBe(1); // rare entry, min 1
    expect(byId.get("obsidian")).toBe(1); // the portal-repair kit
    expect(byId.get("nether_brick")).toBe(2); // common guaranteed entry, min 2
  });

  test("a high roll stays common and drops only the guaranteed salvage", () => {
    const loot = rollFortressLoot(() => 0.999);
    expect(loot.some((d) => d.itemId === "blazite_ore")).toBe(false); // not the rare tier
    expect(loot.some((d) => d.itemId === "redstone")).toBe(false); // chance-gated, skipped
    expect(loot.some((d) => d.itemId === "nether_brick")).toBe(true); // always drops
  });

  test("a roll can never overflow a chest, so loot is never silently dropped", () => {
    const maxEntries = FORTRESS_LOOT.common.length + FORTRESS_LOOT.rare.length;
    expect(maxEntries).toBeLessThanOrEqual(CHEST_SLOTS);

    const rng = seededRng(0xfeed);
    for (let i = 0; i < 500; i += 1) {
      const incoming = rollFortressLoot(rng).map((drop) => createSlot(drop.itemId, drop.count));
      const slots = Array.from({ length: CHEST_SLOTS }, () => createEmptySlot());
      expect(tryInsertSlots(slots, incoming)).not.toBeNull();
    }
  });

  test("counts are always positive", () => {
    const rng = seededRng(0xbeef);
    for (let i = 0; i < 200; i += 1) {
      for (const drop of rollFortressLoot(rng)) {
        expect(drop.count).toBeGreaterThan(0);
      }
    }
  });
});
