import { describe, expect, test } from "bun:test";
import { ITEM_DEF_BY_ID } from "@/lib/game/items";
import { DUNGEON_LOOT, rollDungeonLoot, seededRng, type LootTier } from "@/lib/game/dungeonLoot";

const ALL_TIERS = Object.keys(DUNGEON_LOOT) as LootTier[];

describe("dungeon loot tables", () => {
  test("every loot entry references an existing item with a sane range", () => {
    for (const tier of ALL_TIERS) {
      for (const entry of DUNGEON_LOOT[tier]) {
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

  test("seededRng is deterministic for a given seed", () => {
    const a = seededRng(12345);
    const b = seededRng(12345);
    const c = seededRng(99999);
    const seqA = [a(), a(), a(), a()];
    const seqB = [b(), b(), b(), b()];
    expect(seqA).toEqual(seqB);
    expect([c(), c(), c(), c()]).not.toEqual(seqA);
  });

  test("rolling the same seed yields identical loot (reproducible until opened)", () => {
    const loot1 = rollDungeonLoot(seededRng(0x1234));
    const loot2 = rollDungeonLoot(seededRng(0x1234));
    expect(loot1).toEqual(loot2);
  });

  test("a low roll opens the rare tier and yields minimum counts", () => {
    // rng() === 0: tier roll (0 < RARE_CHEST_CHANCE) is rare; every chance entry
    // passes (0 >= chance is false) and counts floor to their minimum.
    const loot = rollDungeonLoot(() => 0);
    const byId = new Map(loot.map((d) => [d.itemId, d.count]));
    expect(byId.get("diamond_ore")).toBe(1); // rare entry, min 1
    expect(byId.get("bone")).toBe(1); // common guaranteed entry, min 1
  });

  test("a high roll stays common and drops only the guaranteed entries", () => {
    // rng() === 0.999: not rare, and every chance-gated entry is skipped, so
    // only the always-on entries (bone/string/seeds) can appear.
    const loot = rollDungeonLoot(() => 0.999);
    expect(loot.some((d) => d.itemId === "bread")).toBe(false); // chance-gated, skipped
    expect(loot.some((d) => d.itemId === "diamond_ore")).toBe(false); // not the rare tier
    expect(loot.some((d) => d.itemId === "bone")).toBe(true); // always drops
  });

  test("counts are always positive", () => {
    const rng = seededRng(0xbeef);
    for (let i = 0; i < 200; i += 1) {
      for (const drop of rollDungeonLoot(rng)) {
        expect(drop.count).toBeGreaterThan(0);
      }
    }
  });
});
